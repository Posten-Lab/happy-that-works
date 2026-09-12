import { apiSocket } from '@/sync/apiSocket';
import { sync } from '@/sync/sync';
import { AgentDefinitionSchema, type AgentDefinition } from './agentDefinition';

/** Save an immutable copy in encrypted session metadata, preserving unrelated fields on conflicts. */
export async function saveSessionAgentProfile(sessionId: string, profile: AgentDefinition): Promise<void> {
    const snapshot = AgentDefinitionSchema.parse(profile);
    const encryption = sync.encryption.getSessionEncryption(sessionId);
    if (!encryption) throw new Error('Session encryption is not ready');
    const response = await apiSocket.request(`/v1/sessions/${encodeURIComponent(sessionId)}`);
    if (!response.ok) throw new Error('Could not load the new session');
    let current = (await response.json()).session;
    for (let attempt = 0; attempt < 4; attempt++) {
        const metadata = await encryption.decryptRaw(current.metadata);
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Could not decrypt the new session');
        const result = await apiSocket.emitWithAck<{ result: string; version?: number; metadata?: string }>('update-metadata', {
            sid: sessionId,
            expectedVersion: current.metadataVersion,
            metadata: await encryption.encryptRaw({ ...metadata, agentProfile: snapshot, name: snapshot.name }),
        }, 15_000);
        if (result.result === 'success') {
            await sync.refreshSessions();
            return;
        }
        if (result.result !== 'version-mismatch' || typeof result.version !== 'number' || typeof result.metadata !== 'string') throw new Error('Could not save the agent configuration');
        current = { metadata: result.metadata, metadataVersion: result.version };
    }
    throw new Error('Session configuration kept changing. Please try again.');
}
