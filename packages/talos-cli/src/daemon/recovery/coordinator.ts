import type { SessionCheckpoint } from './checkpoint';

export type RecoverySessionStatus = {
    sessionId: string;
    status: 'pending' | 'restoring' | 'restored' | 'failed';
    attempts: number;
    updatedAt: number;
    error?: string;
};
export type RecoveryState = { enabled: boolean; sessions: RecoverySessionStatus[] };
export type RecoveryLedgerEntry = RecoverySessionStatus & {
    retryAt?: number;
    instanceId?: string;
    healthySince?: number;
};

type Dependencies = {
    read: () => SessionCheckpoint[];
    isAlive: (checkpoint: SessionCheckpoint) => boolean;
    resume: (checkpoint: SessionCheckpoint) => Promise<{ type: string; errorMessage?: string }>;
    enabled: () => boolean;
    ready: () => boolean;
    serverUrl: string;
    machineId: string;
    now?: () => number;
    load?: () => RecoveryLedgerEntry[];
    save?: (entries: RecoveryLedgerEntry[]) => void;
};

/** Serial reconciliation with a durable retry budget, including crashes after a successful spawn. */
export class SessionRecoveryCoordinator {
    private statuses = new Map<string, RecoveryLedgerEntry>();
    private busy = false;
    private stopped = false;
    private persistenceUnavailable = false;
    constructor(private deps: Dependencies) {
        try {
            for (const entry of deps.load?.() ?? []) {
                // Daemon downtime is not evidence that a restored process stayed healthy.
                this.statuses.set(entry.sessionId, { ...entry, healthySince: undefined });
            }
        } catch {
            this.persistenceUnavailable = true;
            for (const c of deps.read()) {
                if (c.serverUrl !== deps.serverUrl || c.metadata.machineId !== deps.machineId || c.desiredState !== 'running') continue;
                this.statuses.set(c.sessionId, { sessionId: c.sessionId, status: 'failed', attempts: 3,
                    updatedAt: (deps.now ?? Date.now)(), error: 'Saved recovery status is unreadable. Resume manually to retry.' });
            }
        }
    }

    stop() { this.stopped = true; }

    private set(entry: RecoveryLedgerEntry) {
        this.statuses.set(entry.sessionId, entry);
        try { this.deps.save?.([...this.statuses.values()]); }
        catch (error) {
            this.persistenceUnavailable = true;
            this.statuses.set(entry.sessionId, { ...entry, status: 'failed', error: 'Recovery status could not be saved. Resume manually to retry.' });
            throw error;
        }
    }

    private remove(sessionId: string) {
        if (this.statuses.delete(sessionId)) this.deps.save?.([...this.statuses.values()]);
    }

    getState(): RecoveryState {
        return {
            enabled: this.deps.enabled(),
            sessions: [...this.statuses.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50)
                .map(({ retryAt, instanceId, healthySince, ...status }) => status),
        };
    }

    async tick(): Promise<void> {
        if (this.stopped || this.busy || this.persistenceUnavailable || !this.deps.ready()) return;
        this.busy = true;
        try {
            const now = this.deps.now ?? Date.now;
            const checkpoints = this.deps.read().filter(c => c.serverUrl === this.deps.serverUrl
                && c.metadata.machineId === this.deps.machineId);
            const ids = new Set(checkpoints.map(c => c.sessionId));
            for (const id of this.statuses.keys()) if (!ids.has(id)) this.remove(id);
            for (const c of checkpoints) {
                if (this.stopped || !this.deps.ready()) return;
                if (c.desiredState !== 'running') { this.remove(c.sessionId); continue; }
                let status = this.statuses.get(c.sessionId);
                if (this.deps.isAlive(c)) {
                    if (!status) continue;
                    if (status.status !== 'restored' || status.instanceId !== c.instanceId || status.healthySince === undefined) {
                        this.set({ ...status, status: 'restored', instanceId: c.instanceId, healthySince: now(), error: undefined, updatedAt: now() });
                    } else if (status.attempts > 0 && now() - status.healthySince >= 60_000) {
                        this.set({ ...status, attempts: 0, updatedAt: now() });
                    }
                    continue;
                }
                if (!this.deps.enabled()) continue;
                if (status?.status === 'restored') {
                    status = { ...status, status: 'pending', healthySince: undefined, error: 'The restored session exited unexpectedly.', updatedAt: now() };
                    this.set(status);
                }
                if (status && status.attempts >= 3) {
                    if (status.status !== 'failed') this.set({ ...status, status: 'failed', updatedAt: now() });
                    continue;
                }
                if ((status?.retryAt ?? 0) > now()) continue;
                const latest = this.deps.read().find(s => s.sessionId === c.sessionId);
                if (!latest || latest.desiredState !== 'running' || this.deps.isAlive(latest) || !this.deps.enabled()) continue;
                const restoring: RecoveryLedgerEntry = {
                    sessionId: c.sessionId, status: 'restoring', attempts: (status?.attempts ?? 0) + 1, updatedAt: now(),
                    retryAt: now() + 30_000,
                };
                // Persist before spawning: a daemon crash must not reset the retry budget.
                this.set(restoring);
                let result: { type: string; errorMessage?: string };
                try { result = await this.deps.resume(latest); }
                catch { result = { type: 'error', errorMessage: 'Session recovery failed. Resume manually to retry.' }; }
                const current = this.deps.read().find(s => s.sessionId === c.sessionId);
                if (!current || current.desiredState !== 'running') { this.remove(c.sessionId); continue; }
                this.set({
                    ...restoring,
                    status: result.type === 'success' ? 'restored' : restoring.attempts >= 3 ? 'failed' : 'pending',
                    error: result.type === 'success' ? undefined : result.errorMessage ?? 'Unable to restore session.',
                    updatedAt: now(),
                    retryAt: now() + [2000, 10_000, 30_000][restoring.attempts - 1],
                });
            }
        } finally { this.busy = false; }
    }
}
