import { apiSocket } from './apiSocket';
import { sync } from './sync';

type SessionMetadataRecord = { id: string; metadata: string; metadataVersion: number };

async function fetchSessionMetadata(sessionId: string): Promise<SessionMetadataRecord> {
    const response = await apiSocket.request(`/v1/sessions/${encodeURIComponent(sessionId)}`);
    if (response.ok) return (await response.json()).session;
    if (response.status !== 404) throw new Error(`Could not load session: ${response.status}`);

    // Older servers do not expose single-session reads. Page through all sessions,
    // including inactive sessions, so old conversations remain safe to archive.
    let cursor: string | null = null;
    const seen = new Set<string>();
    do {
        const page = await apiSocket.request(`/v2/sessions?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        if (!page.ok) throw new Error(`Could not load session: ${page.status}`);
        const data = await page.json() as { sessions: SessionMetadataRecord[]; nextCursor: string | null; hasNext: boolean };
        const session = data.sessions.find(value => value.id === sessionId);
        if (session) return session;
        cursor = data.hasNext ? data.nextCursor : null;
        if (cursor && seen.has(cursor)) throw new Error('Could not finish loading session history');
        if (cursor) seen.add(cursor);
    } while (cursor);
    throw new Error('Session not found');
}

/** Persist intent before deactivation so an offline machine cannot resurrect it. */
export async function persistSessionArchiveIntent(sessionId: string): Promise<void> {
    const encryption = sync.encryption.getSessionEncryption(sessionId);
    if (!encryption) throw new Error('Session encryption is not available');
    let current = await fetchSessionMetadata(sessionId);

    for (let attempt = 0; attempt < 4; attempt++) {
        // Use raw metadata: the app schema intentionally omits provider-specific
        // fields, which must survive this update as well as version conflicts.
        const metadata = await encryption.decryptRaw(current.metadata);
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
            throw new Error('Could not decrypt session metadata');
        }
        const archivedMetadata = await encryption.encryptRaw({
            ...metadata,
            lifecycleState: 'archived',
            lifecycleStateSince: Date.now(),
            archivedBy: 'user',
            archiveReason: 'Archived from the app',
        });
        const result = await apiSocket.emitWithAck<{
            result: 'success' | 'version-mismatch' | 'error';
            version?: number;
            metadata?: string;
        }>('update-metadata', {
            sid: sessionId,
            metadata: archivedMetadata,
            expectedVersion: current.metadataVersion,
        }, 15_000);
        if (result.result === 'success') return;
        if (result.result !== 'version-mismatch' || typeof result.version !== 'number' || typeof result.metadata !== 'string') {
            throw new Error('Could not save session archive state');
        }
        current = { id: sessionId, metadata: result.metadata, metadataVersion: result.version };
    }
    throw new Error('Session changed while archiving. Please try again.');
}
