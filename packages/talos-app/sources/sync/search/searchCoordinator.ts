import { archiveCutoff, sessionInSearchWindow, SessionSearchIndex, type SearchMessage, type SearchSession } from './searchIndex';

// Bound requests/crypto work on phones while overlapping network and storage
// latency. A worker may append a continuation, behind the other sessions.
const SEARCH_CONCURRENCY = 6;
async function drainQueue<T>(queue: T[], current: () => boolean, process: (item: T) => Promise<void>) {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(SEARCH_CONCURRENCY, queue.length) }, async () => {
        while (current() && next < queue.length) await process(queue[next++]);
    }));
}

export type SearchSessionDescriptor = {
    id: string; seq: number; metadata: string; metadataVersion: number;
    agentState: string | null; agentStateVersion: number; dataEncryptionKey: string | null;
    active: boolean; activeAt: number; createdAt: number; updatedAt: number; lastMessageAt: number | null;
};

type CachedSession = {
    version: 1;
    descriptor: SearchSessionDescriptor;
    session: SearchSession;
    cursor: number;
    complete: boolean;
    indexedSeq?: number;
    retryFromSeq?: number;
    messages: SearchMessage[];
    chunks?: string[];
};

export type SearchDependencies = {
    listSessions(cursor: string | null, since: number | null, signal: AbortSignal): Promise<{ sessions: SearchSessionDescriptor[]; nextCursor: string | null; hasNext: boolean }>;
    decryptSession(descriptor: SearchSessionDescriptor): Promise<SearchSession>;
    getSession?(id: string): Promise<SearchSessionDescriptor>;
    readMessages(descriptor: SearchSessionDescriptor, afterSeq: number, signal: AbortSignal): Promise<{ messages: SearchMessage[]; lastSeq: number; hasMore: boolean; failedCount?: number }>;
    openSession(descriptor: SearchSessionDescriptor, seq?: number): Promise<void>;
    encrypt(value: unknown): Promise<string>;
    decrypt(value: string): Promise<unknown>;
    dispose?(): void;
    cache: { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; remove(key: string): Promise<void>; clear(): Promise<void> };
};

export type SearchSnapshot = {
    revision: number; isIndexing: boolean; indexedSessions: number; totalSessions: number;
    error: string | null; allHistory: boolean;
};

/** Separate from rendered chat state: walking history must not mount conversations
 * or move the chat's pagination cursors. Durable cursors advance only after the
 * corresponding decrypted text is saved successfully.
 */
export class SearchCoordinator {
    private dependencies: SearchDependencies | null = null;
    private index = new SessionSearchIndex();
    private records = new Map<string, CachedSession>();
    private listeners = new Set<() => void>();
    private snapshot: SearchSnapshot = { revision: 0, isIndexing: false, indexedSessions: 0, totalSessions: 0, error: null, allHistory: false };
    private generation = 0;
    private controller: AbortController | null = null;
    private job: Promise<void> | null = null;
    private wanted = false;
    private restored = false;
    private refreshTimer: ReturnType<typeof setTimeout> | null = null;
    private writes: Promise<unknown> = Promise.resolve();
    private removed = new Set<string>();
    private dirty = new Set<string>();
    private persistedMessages = new Map<string, number>();
    private messageKeys = new Map<string, Set<string>>();

    subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
    getSnapshot = () => this.snapshot;
    search = (query: string, options: { includeAgentReplies?: boolean } = {}) => this.index.search(query, { ...options, allHistory: this.snapshot.allHistory });

    configure(dependencies: SearchDependencies) {
        this.stop();
        this.dependencies?.dispose?.();
        this.dependencies = dependencies;
        this.restored = false;
        this.records.clear();
        this.removed.clear();
        this.dirty.clear();
        this.persistedMessages.clear();
        this.messageKeys.clear();
        this.index = new SessionSearchIndex();
        this.publish({ indexedSessions: 0, totalSessions: 0, error: null, allHistory: false });
    }

    private publish(patch: Partial<SearchSnapshot> = {}) {
        this.snapshot = { ...this.snapshot, ...patch, revision: this.snapshot.revision + 1 };
        this.listeners.forEach(listener => listener());
    }

    private publishProgress(patch: Partial<SearchSnapshot> = {}, indexChanged = false) {
        let indexedSessions = 0;
        for (const record of this.records.values()) {
            if (record.complete && record.retryFromSeq === undefined && record.indexedSeq === record.descriptor.seq
                && !this.dirty.has(record.session.id) && sessionInSearchWindow(record.session, this.snapshot.allHistory)) indexedSessions++;
        }
        const next = { indexedSessions, ...patch };
        if (indexChanged || Object.entries(next).some(([key, value]) => this.snapshot[key as keyof SearchSnapshot] !== value)) this.publish(next);
    }

    isConfigured = () => this.dependencies !== null;

    start = async (options: { allHistory?: boolean; refresh?: boolean } = {}) => {
        const changedWindow = options.allHistory !== undefined && options.allHistory !== this.snapshot.allHistory;
        if (changedWindow) this.stop();
        this.wanted = options.refresh !== false;
        if (options.allHistory !== undefined) this.publish({ allHistory: options.allHistory });
        if (!this.dependencies) { this.publish({ error: 'Search is waiting for your account to connect.' }); return; }
        if (this.job && !changedWindow) return this.job;
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        const generation = ++this.generation;
        const controller = new AbortController();
        this.controller = controller;
        this.publishProgress({ isIndexing: true, error: null });
        const dependencies = this.dependencies;
        const job = this.run(dependencies, generation, controller.signal).catch(error => {
            if (generation === this.generation && !controller.signal.aborted) {
                this.publish({ error: error instanceof Error ? error.message : 'Could not finish searching history. Please retry.' });
            }
        }).finally(() => {
            if (generation === this.generation) {
                this.job = null;
                this.publish({ isIndexing: false });
                // Reconcile archives, renames, missed socket events and deletions
                // while the app is active; cached pages make repeat scans cheap.
                if (this.wanted) this.refreshTimer = setTimeout(() => { void this.start(); }, 30_000);
            }
        });
        this.job = job;
        return job;
    };

    stop = () => {
        this.wanted = false;
        this.generation++;
        this.controller?.abort();
        this.controller = null;
        this.job = null;
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.refreshTimer = null;
        this.publish({ isIndexing: false });
    };

    invalidate = () => {
        if (!this.wanted || this.job) return;
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => { void this.start(); }, 500);
    };

    updateSession(session: { id: string; active: boolean; metadata: { summary?: { text: string } } | null }) {
        const cached = this.records.get(session.id);
        if (!cached) { this.invalidate(); return; }
        const title = session.metadata?.summary?.text ?? cached.session.title;
        if (title === cached.session.title && session.active === cached.session.active) return;
        cached.session = { ...cached.session, title, active: session.active };
        this.dirty.add(session.id);
        this.index.upsertSession(cached.session);
        this.publish();
        this.invalidate();
    }

    removeSession = (id: string) => {
        this.removed.add(id);
        const record = this.records.get(id);
        const chunks = record?.chunks ?? [];
        this.records.delete(id);
        this.dirty.delete(id);
        this.persistedMessages.delete(id);
        this.messageKeys.delete(id);
        this.index.removeSession(id);
        this.publishProgress({ totalSessions: Math.max(0, this.snapshot.totalSessions - (record ? 1 : 0)) }, true);
        const dependencies = this.dependencies;
        if (dependencies) this.enqueueWrite(async () => {
            await dependencies.cache.remove(id);
            for (const key of chunks) await dependencies.cache.remove(key);
        });
    };

    /** Logout invalidates in-flight decryptions/writes before clearing the account cache. */
    clear = async () => {
        this.stop();
        const dependencies = this.dependencies;
        this.dependencies = null;
        dependencies?.dispose?.();
        this.records.clear();
        this.dirty.clear();
        this.persistedMessages.clear();
        this.messageKeys.clear();
        this.index = new SessionSearchIndex();
        this.restored = false;
        this.publish({ totalSessions: 0, indexedSessions: 0, error: null });
        await this.writes;
        await dependencies?.cache.clear();
    };

    openSession = async (id: string, seq?: number) => {
        const dependencies = this.dependencies;
        if (!dependencies) throw new Error('Search is waiting for your account to connect.');
        const descriptor = this.records.get(id)?.descriptor ?? await dependencies.getSession?.(id);
        if (!descriptor) throw new Error('This session is no longer available. Refresh search and try again.');
        if (dependencies !== this.dependencies) throw new Error('Search account disconnected.');
        await dependencies.openSession(descriptor, seq);
        if (dependencies !== this.dependencies) throw new Error('Search account disconnected.');
    };

    private enqueueWrite(write: () => Promise<void>) {
        const result = this.writes.then(write);
        this.writes = result.catch(() => {});
        return result;
    }

    private appendMessages(record: CachedSession, messages: SearchMessage[]) {
        let keys = this.messageKeys.get(record.session.id);
        if (!keys) this.messageKeys.set(record.session.id, keys = new Set());
        const blocks = new Map<string, number>();
        for (const message of messages) {
            const row = `${message.seq}:${message.messageId}`;
            const block = blocks.get(row) ?? 0;
            blocks.set(row, block + 1);
            const key = `${row}:${block}`;
            if (keys.has(key)) continue;
            keys.add(key);
            record.messages.push(message);
        }
    }

    private async save(dependencies: SearchDependencies, record: CachedSession, generation: number) {
        const session = record.session;
        const savedCount = this.persistedMessages.get(session.id) ?? 0;
        const pending = record.messages.slice(savedCount);
        const chunkKey = `${session.id}:messages:${savedCount}`;
        const chunks = [...(record.chunks ?? [])];
        const chunk = pending.length ? await dependencies.encrypt(pending) : null;
        if (chunk) chunks.push(chunkKey);
        // Append only the new page, then publish its small checkpoint. An
        // interrupted write leaves the old checkpoint valid and is retried.
        const encrypted = await dependencies.encrypt({ ...record, chunks, messages: [] });
        if (generation !== this.generation || this.removed.has(record.session.id)) return;
        await this.enqueueWrite(async () => {
            if (generation !== this.generation || this.removed.has(record.session.id)) return;
            if (chunk) await dependencies.cache.set(chunkKey, chunk);
            if (generation !== this.generation || this.removed.has(record.session.id)) {
                if (chunk) await dependencies.cache.remove(chunkKey);
                return;
            }
            await dependencies.cache.set(record.session.id, encrypted);
            if (this.removed.has(record.session.id)) {
                if (chunk) await dependencies.cache.remove(chunkKey);
                await dependencies.cache.remove(record.session.id);
                return;
            }
            // Once the header commits, keep its referenced chunk together even
            // if a panel close cancels this run. Logout clears the queued writes.
            if (generation !== this.generation || this.removed.has(record.session.id)) return;
            record.chunks = chunks;
            this.persistedMessages.set(session.id, savedCount + pending.length);
            if (record.session === session) this.dirty.delete(session.id);
        });
    }

    private async run(dependencies: SearchDependencies, generation: number, signal: AbortSignal) {
        const current = () => generation === this.generation && !signal.aborted;
        if (!this.restored) {
            // A missing/corrupt/discarded cache is rebuildable. A storage write
            // failure later is surfaced so we never promise durable completion.
            try {
                const manifest = await dependencies.cache.get('manifest');
                const ids = manifest ? await dependencies.decrypt(manifest) : [];
                if (!current()) return;
                if (Array.isArray(ids)) await drainQueue([...new Set(ids.filter((id): id is string => typeof id === 'string'))], current, async id => {
                    if (this.removed.has(id) || this.records.has(id)) return;
                    try {
                        const encrypted = await dependencies.cache.get(id);
                        if (!encrypted || !current()) return;
                        const cached = await dependencies.decrypt(encrypted) as CachedSession | null;
                        if (!current()) return;
                        if (this.removed.has(id)) return;
                        if (cached?.version !== 1 || cached.session?.id !== id || !Array.isArray(cached.messages)) return;
                        for (const key of cached.chunks ?? []) {
                            const chunk = await dependencies.cache.get(key);
                            const messages = chunk ? await dependencies.decrypt(chunk) : null;
                            if (!current()) return;
                            if (!Array.isArray(messages)) throw new Error('Incomplete search cache');
                            cached.messages.push(...messages);
                        }
                        if (this.removed.has(id)) return;
                        const messages = cached.messages;
                        cached.messages = [];
                        this.appendMessages(cached, messages);
                        this.records.set(id, cached);
                        this.persistedMessages.set(id, cached.chunks ? cached.messages.length : 0);
                        this.index.upsertSession(cached.session);
                        this.index.addMessages(id, cached.messages);
                        this.publishProgress({ totalSessions: this.records.size }, true);
                    } catch { /* Rebuild this session; other cached histories are still usable. */ }
                });
            } catch { /* Private browsing/cache eviction: use the relay to rebuild. */ }
            if (!current()) return;
            this.restored = true;
            this.publish();
        }

        const seen = new Set<string>();
        const descriptors: SearchSessionDescriptor[] = [];
        let titleFailures = 0;
        const since = this.snapshot.allHistory ? null : archiveCutoff();
        let cursor: string | null = null;
        do {
            const page = await dependencies.listSessions(cursor, since, signal);
            if (!current()) return;
            const newDescriptors = page.sessions.filter(descriptor => {
                if (this.removed.has(descriptor.id) || seen.has(descriptor.id)) return false;
                seen.add(descriptor.id);
                descriptors.push(descriptor);
                return true;
            });
            await drainQueue(newDescriptors, current, async descriptor => {
                const record = this.records.get(descriptor.id);
                let session: SearchSession;
                try {
                    session = record && record.descriptor.metadata === descriptor.metadata
                        && record.descriptor.metadataVersion === descriptor.metadataVersion
                        && record.descriptor.dataEncryptionKey === descriptor.dataEncryptionKey
                        ? { ...record.session, active: descriptor.active, createdAt: descriptor.createdAt,
                            updatedAt: descriptor.updatedAt, lastMessageAt: descriptor.lastMessageAt }
                        : await dependencies.decryptSession(descriptor);
                }
                catch {
                    if (!current()) return;
                    titleFailures++;
                    return;
                }
                if (!current()) return;
                if (this.removed.has(descriptor.id)) return;
                if (record) {
                    if (JSON.stringify(record.descriptor) !== JSON.stringify(descriptor) || record.session.title !== session.title || record.session.active !== session.active) this.dirty.add(descriptor.id);
                    record.descriptor = descriptor; record.session = session;
                } else {
                    this.records.set(descriptor.id, { version: 1, descriptor, session, cursor: 0, complete: false, messages: [] });
                    this.dirty.add(descriptor.id);
                }
                this.index.upsertSession(session);
            });
            if (!current()) return;
            this.publishProgress({ totalSessions: Math.max(descriptors.length, this.records.size) }, true);
            if (page.hasNext && (!page.nextCursor || page.nextCursor === cursor)) throw new Error('Session history pagination stalled. Please retry.');
            cursor = page.hasNext ? page.nextCursor : null;
        } while (cursor && current());
        if (!current()) return;

        // Only a complete successful enumeration can prove a cached session was
        // deleted or moved outside the requested window. Never prune on failure.
        for (const id of this.records.keys()) {
            if (!current()) return;
            if (!seen.has(id)) {
                const chunks = this.records.get(id)?.chunks ?? [];
                this.records.delete(id);
                this.dirty.delete(id);
                this.persistedMessages.delete(id);
                this.messageKeys.delete(id);
                this.index.removeSession(id);
                await this.enqueueWrite(async () => {
                    await dependencies.cache.remove(id);
                    for (const key of chunks) await dependencies.cache.remove(key);
                });
                if (!current()) return;
            }
        }
        const manifest = await dependencies.encrypt([...seen]);
        if (!current()) return;
        await this.enqueueWrite(async () => { if (current()) await dependencies.cache.set('manifest', manifest); });
        if (!current()) return;
        this.publishProgress({ totalSessions: descriptors.filter(item => !this.removed.has(item.id)).length });

        descriptors.sort((a, b) => Number(b.active) - Number(a.active) || (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt));
        let failures = titleFailures;
        const queue = descriptors.map(descriptor => ({ descriptor, afterSeq: undefined as number | undefined, retryFromSeq: undefined as number | undefined }));
        await drainQueue(queue, current, async work => {
            const { descriptor } = work;
            const record = this.records.get(descriptor.id);
            if (!record || this.removed.has(descriptor.id)) return;
            try {
                if (record.complete && record.retryFromSeq === undefined && record.indexedSeq === descriptor.seq) {
                    if (this.dirty.has(descriptor.id)) await this.save(dependencies, record, generation);
                    if (!current()) return;
                    this.publishProgress();
                    return;
                }
                const afterSeq = work.afterSeq ?? record.retryFromSeq ?? record.cursor;
                const page = await dependencies.readMessages(descriptor, afterSeq, signal);
                if (!current()) return;
                if (this.removed.has(descriptor.id)) return;
                if (page.hasMore && page.lastSeq <= afterSeq) throw new Error('Message history pagination stalled.');
                if (page.failedCount) {
                    work.retryFromSeq ??= afterSeq;
                    record.retryFromSeq = Math.min(record.retryFromSeq ?? afterSeq, afterSeq);
                }
                this.appendMessages(record, page.messages);
                this.dirty.add(descriptor.id);
                this.index.addMessages(descriptor.id, page.messages);
                record.cursor = Math.max(record.cursor, page.lastSeq);
                work.afterSeq = page.lastSeq;
                // Keep the old retry checkpoint until a full replay proves
                // which unreadable pages remain. Interrupted retries are safe.
                if (!page.hasMore) record.retryFromSeq = work.retryFromSeq;
                record.complete = !page.hasMore && record.retryFromSeq === undefined;
                if (record.complete) record.indexedSeq = descriptor.seq;
                await this.save(dependencies, record, generation);
                if (!current()) return;
                this.publishProgress({}, true);
                if (page.hasMore) {
                    // Give every conversation a turn before continuing a long
                    // history. Yield to rendering without a fixed per-page delay.
                    queue.push(work);
                    await new Promise(resolve => setTimeout(resolve, 0));
                } else if (record.retryFromSeq !== undefined) failures++;
            } catch (error) {
                if (!current()) return;
                failures++;
            }
            if (current()) this.publishProgress();
        });
        if (current()) this.publish({ error: failures ? `Could not finish indexing ${failures} conversation${failures === 1 ? '' : 's'}. Retry to include their missing history.` : null });
    }
}
