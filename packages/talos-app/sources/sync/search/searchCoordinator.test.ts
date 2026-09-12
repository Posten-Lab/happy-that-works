import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchCoordinator, type SearchDependencies, type SearchSessionDescriptor } from './searchCoordinator';
import { archiveCutoff, type SearchMessage } from './searchIndex';

const now = Date.UTC(2026, 8, 12, 12);
const descriptor = (id: string, overrides: Partial<SearchSessionDescriptor> = {}): SearchSessionDescriptor => ({
    id, seq: 1, metadata: `Title ${id}`, metadataVersion: 1, agentState: null, agentStateVersion: 0,
    dataEncryptionKey: null, active: false, activeAt: now, createdAt: now, updatedAt: now, lastMessageAt: now, ...overrides,
});
const message = (text: string, seq = 1): SearchMessage => ({ messageId: `envelope-${seq}`, seq, text, role: 'user', createdAt: now });
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function fixture(initial: SearchSessionDescriptor[] = [descriptor('one')]) {
    const state = { sessions: initial };
    const history = new Map(initial.map(item => [item.id, [message(`Request for ${item.id}`)]]));
    const storage = new Map<string, string>();
    const vault = new Map<string, unknown>();
    let cipherSequence = 0;
    const cache = {
        get: vi.fn(async (key: string) => storage.get(key) ?? null),
        set: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
        remove: vi.fn(async (key: string) => { storage.delete(key); }),
        clear: vi.fn(async () => { storage.clear(); }),
    };
    const dependencies: SearchDependencies = {
        listSessions: vi.fn(async (cursor: string | null) => {
            const offset = cursor ? Number(cursor.slice('page-'.length)) : 0;
            const sessions = state.sessions.slice(offset, offset + 80);
            const next = offset + sessions.length;
            return { sessions, nextCursor: next < state.sessions.length ? `page-${next}` : null, hasNext: next < state.sessions.length };
        }),
        decryptSession: vi.fn(async item => ({
            id: item.id, title: item.metadata, active: item.active, createdAt: item.createdAt, updatedAt: item.updatedAt, lastMessageAt: item.lastMessageAt,
        })),
        readMessages: vi.fn(async (item, afterSeq) => {
            const remaining = (history.get(item.id) ?? []).filter(message => message.seq > afterSeq);
            const messages = remaining.slice(0, 2);
            return { messages, lastSeq: messages.at(-1)?.seq ?? afterSeq, hasMore: remaining.length > messages.length };
        }),
        openSession: vi.fn(async () => {}),
        // Opaque ciphertext stand-in: storage never sees plaintext. Encryption itself is tested separately.
        encrypt: vi.fn(async value => {
            const ciphertext = `opaque-ciphertext-${++cipherSequence}`;
            vault.set(ciphertext, structuredClone(value));
            return ciphertext;
        }),
        decrypt: vi.fn(async value => {
            if (!vault.has(value)) throw new Error('Unreadable ciphertext');
            return structuredClone(vault.get(value));
        }),
        cache,
    };
    return { dependencies, state, history, storage, vault, cache };
}

const coordinators: SearchCoordinator[] = [];
function create(dependencies: SearchDependencies) {
    const coordinator = new SearchCoordinator();
    coordinator.configure(dependencies);
    coordinators.push(coordinator);
    return coordinator;
}

/** Advance bounded cooperative page yields without triggering the 30-second refresh. */
async function finish(job: Promise<void>) {
    let done = false;
    void job.finally(() => { done = true; });
    for (let index = 0; index < 1000 && !done; index++) await vi.advanceTimersByTimeAsync(10);
    expect(done, 'indexing job must settle within bounded page yields').toBe(true);
    await job;
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
});
afterEach(() => {
    for (const coordinator of coordinators.splice(0)) coordinator.stop();
    vi.clearAllTimers();
    vi.useRealTimers();
});

describe('session search indexing lifecycle', () => {
    it('indexes every page beyond 150 sessions and never opens conversations while indexing', async () => {
        const source = fixture(Array.from({ length: 205 }, (_, index) => descriptor(`conversation-${index}`)));
        source.history.set('conversation-204', [message('Distinctive archived request')]);
        const coordinator = create(source.dependencies);
        await finish(coordinator.start());
        expect(coordinator.getSnapshot()).toMatchObject({ isIndexing: false, indexedSessions: 205, totalSessions: 205, error: null });
        expect(vi.mocked(source.dependencies.listSessions).mock.calls.map(call => call[0])).toEqual([null, 'page-80', 'page-160']);
        expect(vi.mocked(source.dependencies.listSessions).mock.calls.every(call => call[1] === archiveCutoff(now))).toBe(true);
        expect(coordinator.search('Distinctive')[0]).toMatchObject({ sessionId: 'conversation-204', archived: true });
        expect(source.dependencies.openSession).not.toHaveBeenCalled();
        expect([...source.storage.values()].every(value => value.startsWith('opaque-ciphertext-'))).toBe(true);
        await coordinator.openSession('conversation-204', 1);
        expect(source.dependencies.openSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'conversation-204' }), 1);
    });

    it('resumes the last persisted message page after restart and retains searchable partial results', async () => {
        const source = fixture();
        source.history.set('one', [message('first page alpha', 1), message('first page beta', 2), message('later page gamma', 3)]);
        const read = vi.mocked(source.dependencies.readMessages).getMockImplementation()!;
        vi.mocked(source.dependencies.readMessages).mockImplementationOnce(read).mockRejectedValueOnce(new Error('relay disconnected'));
        const coordinator = create(source.dependencies);
        await finish(coordinator.start());
        expect(coordinator.getSnapshot()).toMatchObject({ indexedSessions: 0, totalSessions: 1 });
        expect(coordinator.getSnapshot().error).toMatch(/Could not finish indexing/);
        expect(coordinator.search('alpha')).toHaveLength(1);
        expect(coordinator.search('gamma')).toEqual([]);
        coordinator.stop();

        vi.mocked(source.dependencies.readMessages).mockClear();
        const resumed = create(source.dependencies);
        await finish(resumed.start());
        expect(vi.mocked(source.dependencies.readMessages).mock.calls[0][1]).toBe(2);
        expect(resumed.search('alpha')).toHaveLength(1);
        expect(resumed.search('gamma')).toHaveLength(1);
        expect(resumed.getSnapshot()).toMatchObject({ indexedSessions: 1, error: null });
    });

    it('reports storage failures without claiming durable completion and can rebuild after restart', async () => {
        const source = fixture();
        source.cache.set.mockImplementation(async (key, value) => {
            if (key === 'one') throw new Error('Storage quota exceeded');
            source.storage.set(key, value);
        });
        const coordinator = create(source.dependencies);
        await finish(coordinator.start());
        expect(coordinator.getSnapshot()).toMatchObject({ indexedSessions: 0, isIndexing: false });
        expect(coordinator.getSnapshot().error).toMatch(/Could not finish indexing/);
        expect(coordinator.search('Request')).toHaveLength(1);
        coordinator.stop();
        source.cache.set.mockImplementation(async (key, value) => { source.storage.set(key, value); });
        vi.mocked(source.dependencies.readMessages).mockClear();
        const resumed = create(source.dependencies);
        await finish(resumed.start());
        expect(vi.mocked(source.dependencies.readMessages).mock.calls[0][1]).toBe(0);
        expect(resumed.getSnapshot()).toMatchObject({ indexedSessions: 1, error: null });
    });

    it('retries a failed durable save before reporting the same coordinator as complete', async () => {
        const source = fixture();
        source.cache.set.mockImplementation(async (key, value) => {
            if (key === 'one') throw new Error('Storage quota exceeded');
            source.storage.set(key, value);
        });
        const coordinator = create(source.dependencies);
        await finish(coordinator.start());
        expect(source.storage.has('one')).toBe(false);
        source.cache.set.mockImplementation(async (key, value) => { source.storage.set(key, value); });
        await finish(coordinator.start());
        expect(coordinator.getSnapshot()).toMatchObject({ indexedSessions: 1, error: null });
        expect(source.storage.has('one')).toBe(true);
    });

    it('reuses completed cached sessions while fetching new messages when the server sequence advances', async () => {
        const source = fixture();
        const coordinator = create(source.dependencies);
        await finish(coordinator.start());
        vi.mocked(source.dependencies.readMessages).mockClear();
        await finish(coordinator.start());
        expect(source.dependencies.readMessages).not.toHaveBeenCalled();
        source.state.sessions[0] = descriptor('one', { seq: 2 });
        source.history.set('one', [message('Request for one'), message('Newly arrived marigold prompt', 2)]);
        await finish(coordinator.start());
        expect(vi.mocked(source.dependencies.readMessages).mock.calls[0][1]).toBe(1);
        expect(coordinator.search('marigold')).toHaveLength(1);
    });

    it('continues with other sessions when one encrypted title cannot be read and reports partial coverage', async () => {
        const source = fixture([descriptor('unreadable'), descriptor('healthy')]);
        vi.mocked(source.dependencies.decryptSession).mockRejectedValueOnce(new Error('Invalid ciphertext'));
        const coordinator = create(source.dependencies);
        await finish(coordinator.start());
        expect(coordinator.getSnapshot()).toMatchObject({ indexedSessions: 1, totalSessions: 2, isIndexing: false });
        expect(coordinator.getSnapshot().error).toMatch(/Could not finish indexing 1 conversation/);
        expect(coordinator.search('Request')[0].sessionId).toBe('healthy');
    });

    it('keeps cached conversations on a failed list and prunes them only after a successful complete enumeration', async () => {
        const source = fixture([descriptor('one'), descriptor('two')]);
        source.history.set('two', [message('archived orchid request')]);
        const coordinator = create(source.dependencies);
        await finish(coordinator.start());
        vi.mocked(source.dependencies.listSessions)
            .mockResolvedValueOnce({ sessions: [descriptor('one')], nextCursor: 'next-page', hasNext: true })
            .mockRejectedValueOnce(new Error('Connection interrupted'));
        await finish(coordinator.start());
        expect(coordinator.getSnapshot().error).toBe('Connection interrupted');
        expect(coordinator.search('orchid')).toHaveLength(1);
        expect(source.cache.remove).not.toHaveBeenCalledWith('two');
        source.state.sessions = [descriptor('one')];
        await finish(coordinator.start());
        expect(coordinator.search('orchid')).toEqual([]);
        expect(source.cache.remove).toHaveBeenCalledWith('two');
        expect(coordinator.getSnapshot()).toMatchObject({ totalSessions: 1, indexedSessions: 1, error: null });
    });

    it('widens archived coverage on demand and can return to the 90-day window', async () => {
        const recent = descriptor('recent');
        const old = descriptor('old', { active: false, createdAt: archiveCutoff(now) - 1, lastMessageAt: archiveCutoff(now) - 1 });
        const source = fixture([recent, old]);
        vi.mocked(source.dependencies.listSessions).mockImplementation(async (_cursor, since) => ({
            sessions: since === null ? [recent, old] : [recent], hasNext: false, nextCursor: null,
        }));
        source.history.set('old', [message('historic chrysanthemum prompt')]);
        const coordinator = create(source.dependencies);
        await finish(coordinator.start());
        expect(coordinator.search('chrysanthemum')).toEqual([]);
        await finish(coordinator.start({ allHistory: true }));
        expect(coordinator.search('chrysanthemum')).toHaveLength(1);
        expect(coordinator.getSnapshot()).toMatchObject({ allHistory: true, totalSessions: 2 });
        await finish(coordinator.start({ allHistory: false }));
        expect(coordinator.search('chrysanthemum')).toEqual([]);
        await finish(coordinator.start({ allHistory: true }));
        expect(coordinator.search('chrysanthemum')).toHaveLength(1);
    });

    it('surfaces stalled pagination instead of silently presenting incomplete coverage', async () => {
        const source = fixture();
        vi.mocked(source.dependencies.listSessions).mockResolvedValue({ sessions: [], hasNext: true, nextCursor: null });
        const coordinator = create(source.dependencies);
        await finish(coordinator.start());
        expect(coordinator.getSnapshot()).toMatchObject({ indexedSessions: 0, isIndexing: false });
        expect(coordinator.getSnapshot().error).toMatch(/pagination stalled/);
        expect(source.dependencies.readMessages).not.toHaveBeenCalled();
    });
});

describe('search cancellation and account privacy', () => {
    it('ignores message text returned after cancellation or logout', async () => {
        const source = fixture();
        const pending = deferred<Awaited<ReturnType<SearchDependencies['readMessages']>>>();
        vi.mocked(source.dependencies.readMessages).mockReturnValueOnce(pending.promise);
        const coordinator = create(source.dependencies);
        const job = coordinator.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(source.dependencies.readMessages).toHaveBeenCalled();
        const signal = vi.mocked(source.dependencies.readMessages).mock.calls[0][2];
        await coordinator.clear();
        expect(signal.aborted).toBe(true);
        const revisionAfterLogout = coordinator.getSnapshot().revision;
        pending.resolve({ messages: [message('late private plaintext')], lastSeq: 1, hasMore: false });
        await finish(job);
        expect(coordinator.search('private')).toEqual([]);
        expect(coordinator.getSnapshot()).toMatchObject({ revision: revisionAfterLogout, indexedSessions: 0, totalSessions: 0, isIndexing: false });
        expect(source.storage.size).toBe(0);
        expect(source.cache.set.mock.calls.some(([key]) => key === 'one')).toBe(false);
    });

    it('does not publish stale counts when logout occurs during a cooperative page yield', async () => {
        const source = fixture();
        const coordinator = create(source.dependencies);
        const job = coordinator.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(coordinator.search('Request')).toHaveLength(1);
        await coordinator.clear();
        const revisionAfterLogout = coordinator.getSnapshot().revision;
        await finish(job);
        expect(coordinator.getSnapshot()).toMatchObject({ revision: revisionAfterLogout, indexedSessions: 0, totalSessions: 0 });
        expect(coordinator.search('Request')).toEqual([]);
    });

    it('waits for an already-started cache write before clearing so logout cannot leave resurrected cache records', async () => {
        const source = fixture();
        const write = deferred<void>();
        source.cache.set.mockImplementation(async (key, value) => {
            if (key === 'one') await write.promise;
            source.storage.set(key, value);
        });
        const coordinator = create(source.dependencies);
        const job = coordinator.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(source.cache.set).toHaveBeenCalledWith('one', expect.any(String));
        const logout = coordinator.clear();
        await vi.advanceTimersByTimeAsync(0);
        expect(source.cache.clear).not.toHaveBeenCalled();
        expect(coordinator.search('Request')).toEqual([]);
        write.resolve();
        await logout;
        await finish(job);
        expect(source.cache.clear).toHaveBeenCalledOnce();
        expect(source.storage.size).toBe(0);
    });

    it('does not transfer old-account results when the account changes during decryption', async () => {
        const oldSource = fixture([descriptor('old-account')]);
        const pending = deferred<Awaited<ReturnType<SearchDependencies['decryptSession']>>>();
        vi.mocked(oldSource.dependencies.decryptSession).mockReturnValueOnce(pending.promise);
        const coordinator = create(oldSource.dependencies);
        const oldJob = coordinator.start();
        await vi.advanceTimersByTimeAsync(0);
        const nextSource = fixture([descriptor('new-account')]);
        coordinator.configure(nextSource.dependencies);
        await finish(coordinator.start());
        pending.resolve({ id: 'old-account', title: 'Sensitive account secret', active: true, createdAt: now, updatedAt: now, lastMessageAt: now });
        await finish(oldJob);
        expect(coordinator.search('Sensitive')).toEqual([]);
        expect(coordinator.search('Request')[0].sessionId).toBe('new-account');
        expect(coordinator.getSnapshot()).toMatchObject({ totalSessions: 1, indexedSessions: 1, error: null });
        expect(oldSource.cache.set).not.toHaveBeenCalled();
    });

    it('rejects an open completed after logout so the caller cannot navigate to an old account conversation', async () => {
        const source = fixture();
        source.dependencies.dispose = vi.fn();
        const coordinator = create(source.dependencies);
        await finish(coordinator.start());
        const pending = deferred<void>();
        vi.mocked(source.dependencies.openSession).mockReturnValueOnce(pending.promise);
        const opening = coordinator.openSession('one', 1);
        await vi.advanceTimersByTimeAsync(0);
        await coordinator.clear();
        expect(source.dependencies.dispose).toHaveBeenCalledOnce();
        const rejected = expect(opening).rejects.toThrow(/disconnected/);
        pending.resolve();
        await rejected;
    });

    it('rejects a descriptor lookup completed after switching accounts before any open handler runs', async () => {
        const source = fixture();
        const pending = deferred<SearchSessionDescriptor>();
        source.dependencies.getSession = vi.fn(() => pending.promise);
        const coordinator = create(source.dependencies);
        const opening = coordinator.openSession('one', 1);
        await vi.advanceTimersByTimeAsync(0);
        coordinator.configure(fixture([descriptor('new-account')]).dependencies);
        const rejected = expect(opening).rejects.toThrow(/disconnected/);
        pending.resolve(source.state.sessions[0]);
        await rejected;
        expect(source.dependencies.openSession).not.toHaveBeenCalled();
    });

    it('does not restore cached plaintext after logout during cache decryption', async () => {
        const source = fixture();
        const first = create(source.dependencies);
        await finish(first.start());
        first.stop();
        const originalDecrypt = vi.mocked(source.dependencies.decrypt).getMockImplementation()!;
        const cached = await originalDecrypt(source.storage.get('one')!);
        const pending = deferred<unknown>();
        vi.mocked(source.dependencies.decrypt).mockImplementationOnce(originalDecrypt).mockReturnValueOnce(pending.promise);
        const coordinator = create(source.dependencies);
        const job = coordinator.start();
        await vi.advanceTimersByTimeAsync(0);
        await coordinator.clear();
        const revision = coordinator.getSnapshot().revision;
        pending.resolve(cached);
        await finish(job);
        expect(coordinator.search('Request')).toEqual([]);
        expect(coordinator.getSnapshot()).toMatchObject({ revision, totalSessions: 0, indexedSessions: 0 });
        expect(source.storage.size).toBe(0);
    });

    it('does not prune the new account while an old-account cache removal is pending', async () => {
        const source = fixture([descriptor('old-a'), descriptor('old-b')]);
        const coordinator = create(source.dependencies);
        await finish(coordinator.start());
        source.state.sessions = [];
        const pending = deferred<void>();
        source.cache.remove.mockImplementation(async key => {
            if (key === 'old-a') await pending.promise;
            source.storage.delete(key);
        });
        const oldJob = coordinator.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(source.cache.remove).toHaveBeenCalledWith('old-a');
        const next = fixture([descriptor('new-a'), descriptor('new-b')]);
        coordinator.configure(next.dependencies);
        const nextJob = coordinator.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(coordinator.search('Title')).toHaveLength(2);
        pending.resolve();
        await finish(Promise.all([oldJob, nextJob]).then(() => {}));
        expect(coordinator.search('Title')).toHaveLength(2);
        expect(coordinator.getSnapshot()).toMatchObject({ totalSessions: 2, indexedSessions: 2, error: null });
        expect(source.cache.remove.mock.calls.every(([key]) => key === 'old-a' || key.startsWith('old-a:'))).toBe(true);
    });

    it('keeps a deleted session absent when its message request completes later', async () => {
        const source = fixture();
        const pending = deferred<Awaited<ReturnType<SearchDependencies['readMessages']>>>();
        vi.mocked(source.dependencies.readMessages).mockReturnValueOnce(pending.promise);
        const coordinator = create(source.dependencies);
        const job = coordinator.start();
        await vi.advanceTimersByTimeAsync(0);
        coordinator.removeSession('one');
        pending.resolve({ messages: [message('deleted private response')], lastSeq: 1, hasMore: false });
        await finish(job);
        expect(coordinator.search('private')).toEqual([]);
        expect(coordinator.search('Title')).toEqual([]);
        expect(source.storage.has('one')).toBe(false);
        await expect(coordinator.openSession('one')).rejects.toThrow(/no longer available/);
    });

    it('keeps a deleted session absent when cache encryption completes later', async () => {
        const source = fixture();
        const pending = deferred<string>();
        vi.mocked(source.dependencies.encrypt).mockResolvedValueOnce('manifest-ciphertext').mockReturnValueOnce(pending.promise);
        const coordinator = create(source.dependencies);
        const job = coordinator.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(source.dependencies.encrypt).toHaveBeenCalledTimes(2);
        coordinator.removeSession('one');
        await vi.advanceTimersByTimeAsync(0);
        pending.resolve('late-deleted-session-ciphertext');
        await finish(job);
        expect(source.storage.has('one')).toBe(false);
        expect(coordinator.search('Request')).toEqual([]);
    });
});

describe('incremental encrypted search cache', () => {
    it('persists each message only once across pages and restores the full conversation without re-fetching', async () => {
        const source = fixture([descriptor('one', { seq: 5 })]);
        source.history.set('one', Array.from({ length: 5 }, (_, index) => message(`message-${index} daisy`, index + 1)));
        const coordinator = create(source.dependencies);
        await finish(coordinator.start());
        const persistedMessages = [...source.vault.values()].flatMap(value => Array.isArray(value)
            ? value.filter((item): item is SearchMessage => typeof item === 'object' && item !== null && 'messageId' in item) : []);
        expect(persistedMessages.map(message => message.seq)).toEqual([1, 2, 3, 4, 5]);
        coordinator.stop();
        vi.mocked(source.dependencies.readMessages).mockClear();
        const restored = create(source.dependencies);
        await finish(restored.start());
        expect(restored.search('daisy')[0].matchCount).toBe(5);
        expect(source.dependencies.readMessages).not.toHaveBeenCalled();
        expect(restored.getSnapshot()).toMatchObject({ indexedSessions: 1, error: null });
    });

    it('rebuilds missing cache chunks from the beginning instead of silently skipping their messages', async () => {
        const source = fixture([descriptor('one', { seq: 3 })]);
        source.history.set('one', [message('first azalea', 1), message('second azalea', 2), message('third azalea', 3)]);
        const coordinator = create(source.dependencies);
        await finish(coordinator.start());
        coordinator.stop();
        const record = await source.dependencies.decrypt(source.storage.get('one')!) as { chunks: string[] };
        source.storage.delete(record.chunks[0]);
        vi.mocked(source.dependencies.readMessages).mockClear();
        const restored = create(source.dependencies);
        await finish(restored.start());
        expect(vi.mocked(source.dependencies.readMessages).mock.calls[0][1]).toBe(0);
        expect(restored.search('azalea')[0].matchCount).toBe(3);
        expect(restored.getSnapshot()).toMatchObject({ indexedSessions: 1, error: null });
    });

    it('persists renamed metadata even when no new messages have arrived', async () => {
        const source = fixture();
        const coordinator = create(source.dependencies);
        await finish(coordinator.start());
        vi.mocked(source.dependencies.readMessages).mockClear();
        source.state.sessions[0] = descriptor('one', { metadata: 'New camellia title', metadataVersion: 2 });
        coordinator.updateSession({ id: 'one', active: false, metadata: { summary: { text: 'New camellia title' } } });
        expect(coordinator.search('camellia')).toHaveLength(1);
        await finish(coordinator.start());
        expect(source.dependencies.readMessages).not.toHaveBeenCalled();
        const record = await source.dependencies.decrypt(source.storage.get('one')!) as { session: { title: string } };
        expect(record.session.title).toBe('New camellia title');
        expect(coordinator.search('Title')[0].title).toBe('New camellia title');
    });

    it.each(['stop', 'logout'] as const)('cleans up a chunk completed after %s before its checkpoint is written', async action => {
        const source = fixture();
        const pending = deferred<void>();
        source.cache.set.mockImplementation(async (key, value) => {
            if (key.startsWith('one:messages:')) await pending.promise;
            source.storage.set(key, value);
        });
        const coordinator = create(source.dependencies);
        const job = coordinator.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(source.cache.set.mock.calls.some(([key]) => key.startsWith('one:messages:'))).toBe(true);
        const cancelled = action === 'logout' ? coordinator.clear() : Promise.resolve(coordinator.stop());
        pending.resolve();
        await cancelled;
        await finish(job);
        expect([...source.storage.keys()].some(key => key === 'one' || key.startsWith('one:'))).toBe(false);
        if (action === 'logout') expect(coordinator.search('Request')).toEqual([]);
    });

    it.each(['chunk', 'checkpoint'] as const)('removes every encrypted record when a session is deleted during a %s write', async stage => {
        const source = fixture();
        const pending = deferred<void>();
        source.cache.set.mockImplementation(async (key, value) => {
            if (stage === 'chunk' ? key.startsWith('one:messages:') : key === 'one') await pending.promise;
            source.storage.set(key, value);
        });
        const coordinator = create(source.dependencies);
        const job = coordinator.start();
        await vi.advanceTimersByTimeAsync(0);
        coordinator.removeSession('one');
        pending.resolve();
        await finish(job);
        await vi.advanceTimersByTimeAsync(0);
        expect(coordinator.search('Request')).toEqual([]);
        expect([...source.storage.keys()].filter(key => key === 'one' || key.startsWith('one:'))).toEqual([]);
    });
});
