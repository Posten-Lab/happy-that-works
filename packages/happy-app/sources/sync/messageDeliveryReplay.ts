import type { InvalidateSync } from '@/utils/sync';

/**
 * Re-fetch every session message stream that this client has already opened.
 * The per-session cursor makes each invalidation an incremental replay, while
 * InvalidateSync coalesces duplicate resume/focus signals.
 */
export function replayTrackedMessageStreams(messageSyncs: Iterable<InvalidateSync>): void {
    for (const messageSync of messageSyncs) {
        messageSync.invalidate();
    }
}
