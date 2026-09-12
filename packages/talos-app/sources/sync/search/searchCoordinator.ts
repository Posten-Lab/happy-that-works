import { archiveCutoff, SessionSearchIndex, type SearchMessage, type SearchSession } from './searchIndex';

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
        this.publish({ isIndexing: true, indexedSessions: 0, error: null });
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
        const chunks = this.records.get(id)?.chunks ?? [];
        this.records.delete(id);
        this.dirty.delete(id);
        this.persistedMessages.delete(id);
        this.messageKeys.delete(id);
        this.index.removeSession(id);
        this.publish();
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
                if (Array.isArray(ids)) for (const id of ids) {
                    if (!current()) return;
                    if (typeof id !== 'string') continue;
                    if (this.removed.has(id)) continue;
                    const encrypted = await dependencies.cache.get(id);
                    if (!encrypted) continue;
                    const cached = await dependencies.decrypt(encrypted) as CachedSession | null;
                    if (!current()) return;
                    if (this.removed.has(id)) continue;
                    if (cached?.version !== 1 || cached.session?.id !== id || !Array.isArray(cached.messages)) continue;
                    for (const key of cached.chunks ?? []) {
                        const chunk = await dependencies.cache.get(key);
                        const messages = chunk ? await dependencies.decrypt(chunk) : null;
                        if (!current()) return;
                        if (!Array.isArray(messages)) throw new Error('Incomplete search cache');
                        cached.messages.push(...messages);
                    }
                    if (this.removed.has(id)) continue;
                    const messages = cached.messages;
                    cached.messages = [];
                    this.appendMessages(cached, messages);
                    this.records.set(id, cached);
                    this.persistedMessages.set(id, cached.chunks ? cached.messages.length : 0);
                    this.index.upsertSession(cached.session);
                    this.index.addMessages(id, cached.messages);
                }
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
            for (const descriptor of page.sessions) {
                if (this.removed.has(descriptor.id)) continue;
                if (seen.has(descriptor.id)) continue;
                seen.add(descriptor.id);
                descriptors.push(descriptor);
                let session: SearchSession;
                try { session = await dependencies.decryptSession(descriptor); }
                catch {
                    if (!current()) return;
                    titleFailures++;
                    continue;
                }
                if (!current()) return;
                if (this.removed.has(descriptor.id)) continue;
                const record = this.records.get(descriptor.id);
                if (record) {
                    if (JSON.stringify(record.descriptor) !== JSON.stringify(descriptor) || record.session.title !== session.title || record.session.active !== session.active) this.dirty.add(descriptor.id);
                    record.descriptor = descriptor; record.session = session;
                } else {
                    this.records.set(descriptor.id, { version: 1, descriptor, session, cursor: 0, complete: false, messages: [] });
                    this.dirty.add(descriptor.id);
                }
                this.index.upsertSession(session);
            }
            this.publish({ totalSessions: descriptors.length });
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

        descriptors.sort((a, b) => Number(b.active) - Number(a.active) || (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt));
        let indexedSessions = 0;
        let failures = titleFailures;
        for (const descriptor of descriptors) {
            if (!current()) return;
            const record = this.records.get(descriptor.id);
            if (!record) continue;
            try {
                if (record.complete && record.retryFromSeq === undefined && record.indexedSeq === descriptor.seq) {
                    if (this.dirty.has(descriptor.id)) await this.save(dependencies, record, generation);
                    if (!current()) return;
                    indexedSessions++;
                    this.publish({ indexedSessions });
                    continue;
                }
                let afterSeq = record.retryFromSeq ?? record.cursor;
                let retryFromSeq: number | undefined;
                let hasMore: boolean;
                do {
                    const page = await dependencies.readMessages(descriptor, afterSeq, signal);
                    if (!current()) return;
                    if (this.removed.has(descriptor.id)) break;
                    if (page.hasMore && page.lastSeq <= afterSeq) throw new Error('Message history pagination stalled.');
                    if (page.failedCount) {
                        retryFromSeq ??= afterSeq;
                        record.retryFromSeq = Math.min(record.retryFromSeq ?? afterSeq, afterSeq);
                    }
                    this.appendMessages(record, page.messages);
                    this.dirty.add(descriptor.id);
                    this.index.addMessages(descriptor.id, page.messages);
                    record.cursor = Math.max(record.cursor, page.lastSeq);
                    afterSeq = page.lastSeq;
                    // Keep the old retry checkpoint until a full replay proves
                    // which unreadable pages remain. Interrupted retries are safe.
                    if (!page.hasMore) record.retryFromSeq = retryFromSeq;
                    record.complete = !page.hasMore && record.retryFromSeq === undefined;
                    if (record.complete) record.indexedSeq = descriptor.seq;
                    await this.save(dependencies, record, generation);
                    if (!current()) return;
                    this.publish();
                    hasMore = page.hasMore;
                    // Yield between bounded pages; don't monopolize the RN JS thread.
                    await new Promise(resolve => setTimeout(resolve, 10));
                    if (!current()) return;
                } while (hasMore && current());
                if (record.retryFromSeq !== undefined) failures++;
                else indexedSessions++;
            } catch (error) {
                if (!current()) return;
                failures++;
            }
            if (current()) this.publish({ indexedSessions });
        }
        if (current()) this.publish({ error: failures ? `Could not finish indexing ${failures} conversation${failures === 1 ? '' : 's'}. Retry to include their missing history.` : null });
    }
}
