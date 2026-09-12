import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Encryption } from '../encryption/encryption';
import { SearchCoordinator, type SearchDependencies, type SearchSessionDescriptor } from './searchCoordinator';
import type { SearchMessage } from './searchIndex';
import { configureSessionSearch, sessionSearch } from './sessionSearch';

vi.mock('../serverConfig', () => ({ getServerUrl: () => 'http://localhost:3005' }));
vi.mock('../apiSocket', () => ({ getTalosClientId: () => 'test-client' }));
vi.mock('@/utils/parseToken', () => ({ parseToken: () => 'test-account' }));
vi.mock('./searchCache', () => ({ createSearchCache: () => ({ get: async () => null, set: async () => {}, remove: async () => {}, clear: async () => {} }) }));

const now = Date.UTC(2026, 8, 12, 12);
const descriptor: SearchSessionDescriptor = { id: 'history', seq: 4, metadata: 'Title', metadataVersion: 1, agentState: null, agentStateVersion: 0, dataEncryptionKey: null, active: false, activeAt: now, createdAt: now, updatedAt: now, lastMessageAt: now };
const searchable = (seq: number, text: string): SearchMessage => ({ seq, messageId: `message-${seq}`, role: 'user', createdAt: now, text });
const coordinators: SearchCoordinator[] = [];

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => {
    coordinators.splice(0).forEach(coordinator => coordinator.stop());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllTimers();
    vi.useRealTimers();
});

async function finish(job: Promise<void>) {
    let done = false;
    void job.finally(() => { done = true; });
    for (let step = 0; step < 100 && !done; step++) await vi.advanceTimersByTimeAsync(10);
    expect(done).toBe(true);
    await job;
}

function recoveryFixture() {
    const cache = new Map<string, string>();
    const state = { readable: false, failLater: false };
    const reads: number[] = [];
    const dependencies: SearchDependencies = {
        cache: { get: async key => cache.get(key) ?? null, set: async (key, value) => { cache.set(key, value); }, remove: async key => { cache.delete(key); }, clear: async () => { cache.clear(); } },
        encrypt: async value => JSON.stringify(value), decrypt: async value => JSON.parse(value),
        listSessions: async () => ({ sessions: [descriptor], nextCursor: null, hasNext: false }),
        decryptSession: async session => ({ ...session, title: 'Investigation' }),
        openSession: async () => {},
        readMessages: async (_session, afterSeq) => {
            reads.push(afterSeq);
            if (afterSeq === 0) return {
                messages: [searchable(1, 'Healthy early request'), ...(state.readable ? [searchable(2, 'Recovered hidden request')] : [])],
                failedCount: state.readable ? 0 : 1, lastSeq: 2, hasMore: true,
            };
            if (state.failLater) throw new Error('Network interrupted retry');
            return { messages: [searchable(3, 'Healthy later request'), searchable(4, 'Multiple text first'), searchable(4, 'Multiple text second')], lastSeq: 4, hasMore: false };
        },
    };
    const create = () => {
        const coordinator = new SearchCoordinator();
        coordinator.configure(dependencies);
        coordinators.push(coordinator);
        return coordinator;
    };
    return { create, cache, state, reads };
}

describe('unreadable conversation messages', () => {
    it('keeps later pages searchable, persists the retry checkpoint and avoids replay duplicates', async () => {
        const source = recoveryFixture();
        const first = source.create();
        await finish(first.start());
        expect(source.reads).toEqual([0, 2]);
        expect(first.search('Healthy')[0].matchCount).toBe(2);
        expect(first.search('Multiple')[0].matchCount).toBe(2);
        expect(first.getSnapshot()).toMatchObject({ indexedSessions: 0, totalSessions: 1 });
        expect(first.getSnapshot().error).toMatch(/Could not finish indexing/);
        expect(JSON.parse(source.cache.get('history')!)).toMatchObject({ cursor: 4, retryFromSeq: 0, complete: false });
        const chunks = [...source.cache.keys()].filter(key => key.includes(':messages:'));

        await finish(first.start());
        expect(source.reads).toEqual([0, 2, 0, 2]);
        expect(first.search('Healthy')[0].matchCount).toBe(2);
        expect(first.search('Multiple')[0].matchCount).toBe(2);
        expect([...source.cache.keys()].filter(key => key.includes(':messages:'))).toEqual(chunks);
        expect(first.getSnapshot().error).not.toBeNull();
        first.stop();

        source.reads.length = 0;
        source.state.readable = true;
        const restarted = source.create();
        await finish(restarted.start());
        expect(source.reads).toEqual([0, 2]);
        expect(restarted.search('Recovered')[0].matchCount).toBe(1);
        expect(restarted.search('Healthy')[0].matchCount).toBe(2);
        expect(restarted.search('Multiple')[0].matchCount).toBe(2);
        expect(restarted.getSnapshot()).toMatchObject({ indexedSessions: 1, error: null });
        expect(JSON.parse(source.cache.get('history')!).retryFromSeq).toBeUndefined();
        const persisted = [...source.cache.entries()].filter(([key]) => key.includes(':messages:')).flatMap(([, value]) => JSON.parse(value));
        expect(persisted).toHaveLength(5);
    });

    it('retains the earliest retry checkpoint until the replay reaches the end', async () => {
        const source = recoveryFixture();
        const coordinator = source.create();
        await finish(coordinator.start());
        source.state.readable = true;
        source.state.failLater = true;
        await finish(coordinator.start());
        expect(coordinator.search('Recovered')).toHaveLength(1);
        expect(coordinator.getSnapshot().error).not.toBeNull();
        expect(JSON.parse(source.cache.get('history')!)).toMatchObject({ retryFromSeq: 0, complete: false });
        source.state.failLater = false;
        await finish(coordinator.start());
        expect(coordinator.search('Recovered')[0].matchCount).toBe(1);
        expect(coordinator.getSnapshot()).toMatchObject({ indexedSessions: 1, error: null });
    });

    it('isolates malformed ciphertext and retries raw records even when failed decryptions are cached', async () => {
        let dependencies!: SearchDependencies;
        vi.spyOn(sessionSearch, 'configure').mockImplementation(value => { dependencies = value; });
        const raw = [1, 2, 3].map(seq => ({ id: `row-${seq}`, seq, localId: null, createdAt: now, updatedAt: now, content: { t: 'encrypted', c: `cipher-${seq}` } }));
        const cipher = {
            decryptMessages: vi.fn().mockRejectedValue(new Error('Malformed ciphertext in batch')),
            decryptRaw: vi.fn(async (value: string) => value === 'cipher-2' ? null : { role: 'user', content: { type: 'text', text: `Readable ${value}` } }),
        };
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ messages: raw, hasMore: false }) })));
        configureSessionSearch({ token: 'test-token', secret: 'test-secret' }, { anonID: 'test-key', getSessionEncryption: () => cipher } as unknown as Encryption, { applySession: () => {}, loadMessage: async () => {} });
        const page = await dependencies.readMessages(descriptor, 0, new AbortController().signal);
        expect(page).toMatchObject({ failedCount: 1, lastSeq: 3, hasMore: false });
        expect(page.messages.map(message => message.seq)).toEqual([1, 3]);

        cipher.decryptMessages.mockResolvedValue(raw.map(message => ({ ...message, content: null })));
        cipher.decryptRaw.mockImplementation(async value => ({ role: 'user', content: { type: 'text', text: `Recovered ${value}` } }));
        const retried = await dependencies.readMessages(descriptor, 0, new AbortController().signal);
        expect(retried.failedCount).toBe(0);
        expect(retried.messages.map(message => message.seq)).toEqual([1, 2, 3]);
    });
});
