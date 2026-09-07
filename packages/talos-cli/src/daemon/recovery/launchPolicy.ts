import type { Metadata } from '@/api/types';
import { getProcessIdentity } from './checkpoint';

/** Local provider IDs may already have changed while the network was offline. */
export function mergeRecoveryMetadata(local: Metadata, server: Metadata, hasCheckpoint = true): Metadata {
    if (!hasCheckpoint) return { ...local, ...server };
    // Titles, summaries and archive intent are controlled by the latest server
    // state. The session process owns its working directory and provider thread.
    return {
        ...server,
        path: local.path,
        flavor: local.flavor ?? server.flavor,
        claudeSessionId: local.claudeSessionId,
        codexThreadId: local.codexThreadId,
        museSessionId: local.museSessionId,
        museViewCursor: local.museViewCursor,
        currentModelCode: local.currentModelCode,
        currentOperatingModeCode: local.currentOperatingModeCode,
    };
}

export function trackedProcessIsAlive(session: { pid: number; processIdentity?: string | null }): boolean {
    return Boolean(session.processIdentity && getProcessIdentity(session.pid) === session.processIdentity);
}

/** Explicit stops invalidate even a resume still awaiting the server or filesystem. */
export class RecoveryLaunchGenerations {
    private generations = new Map<string, number>();
    capture(sessionId: string) {
        const generation = this.generations.get(sessionId) ?? 0;
        return () => (this.generations.get(sessionId) ?? 0) !== generation;
    }
    cancel(sessionId: string) { this.generations.set(sessionId, (this.generations.get(sessionId) ?? 0) + 1); }
}
