import axios from 'axios';
import { configuration } from '@/configuration';

export type ServerSessionRecord = {
    id: string; metadata: string; metadataVersion: number; agentStateVersion: number; seq: number;
};

/** Read the current archive intent before recovery, including on servers predating the single-session route. */
export async function fetchRecoverySession(token: string, sessionId: string): Promise<ServerSessionRecord | null> {
    const options = { headers: { Authorization: `Bearer ${token}` }, timeout: 10_000 };
    try {
        const response = await axios.get(`${configuration.serverUrl}/v1/sessions/${encodeURIComponent(sessionId)}`, options);
        return response.data.session as ServerSessionRecord;
    } catch (error) {
        if (!axios.isAxiosError(error) || error.response?.status !== 404) throw error;
    }
    let cursor: string | undefined;
    const cursors = new Set<string>();
    do {
        const response = await axios.get(`${configuration.serverUrl}/v2/sessions`, {
            ...options, params: { limit: 200, ...(cursor ? { cursor } : {}) },
        });
        const page = response.data as { sessions: ServerSessionRecord[]; hasNext: boolean; nextCursor?: string };
        const matched = page.sessions.find(s => s.id === sessionId);
        if (matched) return matched;
        if (!page.hasNext) return null;
        if (!page.nextCursor || cursors.has(page.nextCursor)) throw new Error('Server returned an invalid session cursor');
        cursor = page.nextCursor;
        cursors.add(cursor);
    } while (cursor);
    return null;
}
