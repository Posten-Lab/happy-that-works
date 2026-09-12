import MiniSearch from 'minisearch';
import type { NormalizedMessage } from '../typesRaw';
import { parseMessageAsEvent } from '../reducer/messageToEvent';

export const SEARCH_ARCHIVE_DAYS = 90;
export const archiveCutoff = (now = Date.now()) => now - SEARCH_ARCHIVE_DAYS * 24 * 60 * 60 * 1000;

export type SearchMessage = {
    messageId: string;
    seq: number;
    text: string;
    role: 'user' | 'agent';
    createdAt: number;
    blockIndex?: number;
};

export type SearchSession = {
    id: string;
    title: string;
    active: boolean;
    createdAt: number;
    updatedAt: number;
    lastMessageAt: number | null;
};

export type SessionSearchResult = {
    sessionId: string;
    title: string;
    archived: boolean;
    updatedAt: number;
    titleMatch: boolean;
    matches: SearchMessage[];
    matchCount: number;
};

export function sessionInSearchWindow(session: SearchSession, allHistory: boolean, now = Date.now()) {
    return allHistory || session.active || (session.lastMessageAt ?? session.createdAt) >= archiveCutoff(now);
}

/** Index the same visible conversation text as the chat, retaining its normalized ID.
 * Protocol envelopes may have a different ID from their encrypted server record.
 */
export function extractSearchMessages(message: NormalizedMessage, seq: number): SearchMessage[] {
    if (message.isSidechain || message.role === 'event' || parseMessageAsEvent(message)) return [];
    const texts = message.role === 'user'
        ? [message.meta?.displayText ?? message.content.text]
        : message.content.flatMap(content => content.type === 'text' ? [content.text] : []);
    return texts.filter(text => text.trim()).map((text, blockIndex) => ({
        messageId: message.id, seq, text, role: message.role as 'user' | 'agent', createdAt: message.createdAt, blockIndex,
    }));
}

type SearchDocument = { id: string; sessionId: string; title?: string; user?: string; agent?: string; message?: SearchMessage };

export class SessionSearchIndex {
    private sessions = new Map<string, SearchSession>();
    private documents = new Map<string, SearchDocument>();
    private sessionDocuments = new Map<string, Set<string>>();
    private engine = new MiniSearch<SearchDocument>({
        fields: ['title', 'user', 'agent'],
        searchOptions: { boost: { title: 6, user: 3, agent: 1 }, prefix: true, combineWith: 'AND' },
    });

    upsertSession(session: SearchSession) {
        this.sessions.set(session.id, session);
        this.upsert({ id: `${session.id}:title`, sessionId: session.id, title: session.title });
    }

    addMessages(sessionId: string, messages: SearchMessage[]) {
        const occurrences = new Map<string, number>();
        for (const message of messages) {
            const key = `${sessionId}:${message.seq}:${message.messageId}`;
            const block = occurrences.get(key) ?? 0;
            occurrences.set(key, block + 1);
            this.upsert({ id: `${key}:${block}`, sessionId, [message.role === 'user' ? 'user' : 'agent']: message.text,
                message: { ...message, blockIndex: message.blockIndex ?? block } });
        }
    }

    private upsert(document: SearchDocument) {
        const previous = this.documents.get(document.id);
        if (previous) this.engine.remove(previous);
        this.documents.set(document.id, document);
        this.engine.add(document);
        let ids = this.sessionDocuments.get(document.sessionId);
        if (!ids) this.sessionDocuments.set(document.sessionId, ids = new Set());
        ids.add(document.id);
    }

    removeSession(sessionId: string) {
        for (const id of this.sessionDocuments.get(sessionId) ?? []) {
            const document = this.documents.get(id);
            if (document) this.engine.remove(document);
            this.documents.delete(id);
        }
        this.sessionDocuments.delete(sessionId);
        this.sessions.delete(sessionId);
    }

    search(query: string, options: { includeAgentReplies?: boolean; allHistory?: boolean; now?: number } = {}): SessionSearchResult[] {
        const trimmed = query.trim();
        if (!trimmed) return [];
        const groups = new Map<string, SessionSearchResult & { score: number }>();
        const hits = this.engine.search(trimmed, {
            fields: options.includeAgentReplies ? ['title', 'user', 'agent'] : ['title', 'user'],
            fuzzy: term => term.length > 4 ? 1 : false,
        });
        for (const hit of hits) {
            const document = this.documents.get(String(hit.id));
            if (!document) continue;
            const session = this.sessions.get(document.sessionId);
            if (!session || !sessionInSearchWindow(session, !!options.allHistory, options.now)) continue;
            let group = groups.get(session.id);
            if (!group) {
                group = { sessionId: session.id, title: session.title, archived: !session.active,
                    updatedAt: session.lastMessageAt ?? session.createdAt, titleMatch: false, matches: [], matchCount: 0, score: 0 };
                groups.set(session.id, group);
            }
            const text = document.title ?? document.message?.text ?? '';
            const exactBoost = text.toLocaleLowerCase().includes(trimmed.toLocaleLowerCase()) ? 2 : 1;
            // The best matching message determines session relevance. Repetition
            // in a long agent response must not drown out short user prompts.
            group.score = Math.max(group.score, hit.score * exactBoost);
            if (document.title !== undefined) group.titleMatch = true;
            if (document.message) {
                group.matchCount++;
                group.matches.push(document.message);
            }
        }
        return [...groups.values()].sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt)
            .slice(0, 100).map(({ score, ...result }) => result);
    }
}
