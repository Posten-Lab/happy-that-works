import type { SearchSessionDescriptor } from './searchCoordinator';

export class SearchRequestError extends Error {
    constructor(readonly status: number) {
        super(`Unable to load conversation history (${status}). Please retry.`);
    }
}

type Request = <T>(path: string) => Promise<T>;
type SessionPage = { sessions: SearchSessionDescriptor[]; nextCursor: string | null; hasNext: boolean };

/** Older relays support the paginated session list but not single-session GETs. */
export async function getSearchSession(id: string, request: Request): Promise<SearchSessionDescriptor> {
    try {
        return (await request<{ session: SearchSessionDescriptor }>(`/v1/sessions/${encodeURIComponent(id)}`)).session;
    } catch (error) {
        // Only a missing route/session warrants a compatibility lookup. Do not
        // turn authorization, network or server failures into extra requests.
        if (!(error instanceof SearchRequestError) || error.status !== 404) throw error;
    }

    let cursor: string | null = null;
    const visited = new Set<string>();
    while (true) {
        const params = new URLSearchParams({ limit: '200' });
        if (cursor) params.set('cursor', cursor);
        const page = await request<SessionPage>(`/v2/sessions?${params}`);
        const session = page.sessions.find(session => session.id === id);
        if (session) return session;
        if (!page.hasNext) throw new Error('This session is no longer available. Refresh search and try again.');
        if (!page.nextCursor || visited.has(page.nextCursor)) {
            throw new Error('Unable to finish loading conversation history. Please retry.');
        }
        cursor = page.nextCursor;
        visited.add(cursor);
    }
}
