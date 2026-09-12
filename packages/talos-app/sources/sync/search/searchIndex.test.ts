import { describe, expect, it } from 'vitest';
import { normalizeRawMessage, type NormalizedMessage } from '../typesRaw';
import { archiveCutoff, extractSearchMessages, SessionSearchIndex, sessionInSearchWindow, type SearchMessage, type SearchSession } from './searchIndex';

const now = Date.UTC(2026, 8, 12, 12);
const cutoff = archiveCutoff(now);
const session = (id: string, overrides: Partial<SearchSession> = {}): SearchSession => ({
    id, title: `Conversation ${id}`, active: false, createdAt: cutoff - 1, updatedAt: now, lastMessageAt: now, ...overrides,
});
const message = (text: string, overrides: Partial<SearchMessage> = {}): SearchMessage => ({
    messageId: 'message-1', seq: 1, text, role: 'user', createdAt: now, ...overrides,
});

describe('session search relevance and coverage', () => {
    it('ranks a title and a user prompt above repeated agent replies and keeps replies opt-in', () => {
        const index = new SessionSearchIndex();
        index.upsertSession(session('title', { title: 'npm publishing' }));
        index.upsertSession(session('prompt'));
        index.upsertSession(session('reply'));
        index.addMessages('prompt', [message('npm publishing')]);
        index.addMessages('reply', Array.from({ length: 40 }, (_, seq) => message('npm publishing', { seq, messageId: `reply-${seq}`, role: 'agent' })));

        expect(index.search('npm publishing', { now }).map(result => result.sessionId)).toEqual(['title', 'prompt']);
        const expanded = index.search('npm publishing', { includeAgentReplies: true, now });
        expect(expanded.map(result => result.sessionId)).toEqual(['title', 'prompt', 'reply']);
        expect(expanded[0]).toMatchObject({ titleMatch: true, archived: true });
        expect(expanded[2]).toMatchObject({ matchCount: 40 });
        expect(expanded[2].matches.every(message => message.role === 'agent')).toBe(true);
    });

    it('finds words across case, prefixes, punctuation and a typo without returning unrelated conversations', () => {
        const index = new SessionSearchIndex();
        index.upsertSession(session('match', { title: 'NPM: publishing workflow' }));
        index.upsertSession(session('unrelated', { title: 'Vacation planning' }));
        for (const query of ['npm publish', 'NPM PUBLISHING', 'publising']) {
            expect(index.search(query, { now }).map(result => result.sessionId)).toEqual(['match']);
        }
        expect(index.search('   ', { now })).toEqual([]);
        expect(index.search('publishing vacation', { now })).toEqual([]);
    });

    it('uses last-message time for archives and searches old messages within a qualifying conversation', () => {
        const index = new SessionSearchIndex();
        index.upsertSession(session('boundary', { lastMessageAt: cutoff }));
        index.upsertSession(session('renamed-old', { lastMessageAt: cutoff - 1, updatedAt: now }));
        index.upsertSession(session('active-old', { active: true, lastMessageAt: cutoff - 1 }));
        for (const id of ['boundary', 'renamed-old', 'active-old']) {
            index.addMessages(id, [message('forgotten launch request', { createdAt: cutoff - 100_000 })]);
        }
        expect(index.search('forgotten', { now }).map(result => result.sessionId).sort()).toEqual(['active-old', 'boundary']);
        expect(index.search('forgotten', { now, allHistory: true }).map(result => result.sessionId).sort()).toEqual(['active-old', 'boundary', 'renamed-old']);
        expect(sessionInSearchWindow(session('new-empty', { lastMessageAt: null, createdAt: cutoff }), false, now)).toBe(true);
        expect(sessionInSearchWindow(session('old-empty', { lastMessageAt: null, createdAt: cutoff - 1 }), false, now)).toBe(false);
    });

    it('refreshes renamed titles, avoids duplicate message matches on replay, and removes deleted sessions', () => {
        const index = new SessionSearchIndex();
        index.upsertSession(session('one', { title: 'Original title' }));
        const page = [message('release request'), message('release response', { role: 'agent', messageId: 'answer', seq: 2 })];
        index.addMessages('one', page);
        index.addMessages('one', page);
        index.upsertSession(session('one', { title: 'Changed title' }));
        expect(index.search('Original', { now })).toEqual([]);
        expect(index.search('Changed', { now })[0].title).toBe('Changed title');
        expect(index.search('release', { includeAgentReplies: true, now })[0].matchCount).toBe(2);
        index.removeSession('one');
        expect(index.search('release', { includeAgentReplies: true, now })).toEqual([]);
        expect(index.search('Changed', { now })).toEqual([]);
    });
});

describe('searchable conversation text', () => {
    it('retains protocol envelope identity and timestamp for precise navigation', () => {
        const normalized = normalizeRawMessage('encrypted-database-row', null, now + 1000, {
            role: 'agent',
            content: { type: 'session', data: { id: 'visible-envelope-id', role: 'user', time: now, ev: { t: 'text', text: 'Find this prompt' } } },
        });
        expect(normalized).not.toBeNull();
        expect(extractSearchMessages(normalized!, 42)).toEqual([{
            messageId: 'visible-envelope-id', seq: 42, text: 'Find this prompt', role: 'user', createdAt: now, blockIndex: 0,
        }]);
    });

    it('keeps distinct visible agent block positions so a result opens the selected excerpt', () => {
        const normalized: NormalizedMessage = {
            id: 'multi-block-envelope', localId: null, createdAt: now, role: 'agent', isSidechain: false,
            content: [
                { type: 'text', text: 'First publishing proposal', uuid: 'first', parentUUID: null },
                { type: 'thinking', thinking: 'Private reasoning', uuid: 'thinking', parentUUID: null },
                { type: 'text', text: '  \n ', uuid: 'blank', parentUUID: null },
                { type: 'tool-call', id: 'tool', name: 'exec_command', input: {}, description: null, uuid: 'tool', parentUUID: null },
                { type: 'text', text: 'Second publishing revision', uuid: 'second', parentUUID: null },
                { type: 'text', text: 'Second publishing revision', uuid: 'duplicate', parentUUID: null },
            ],
        };
        const blocks = extractSearchMessages(normalized, 27);
        expect(blocks.map(({ text, blockIndex }) => ({ text, blockIndex }))).toEqual([
            { text: 'First publishing proposal', blockIndex: 0 },
            { text: 'Second publishing revision', blockIndex: 1 },
            { text: 'Second publishing revision', blockIndex: 2 },
        ]);
        const index = new SessionSearchIndex();
        index.upsertSession(session('multi-block'));
        index.addMessages('multi-block', blocks);
        const result = index.search('publising revision', { includeAgentReplies: true, now })[0];
        expect(result.matchCount).toBe(2);
        expect(result.matches.map(({ messageId, seq, blockIndex }) => ({ messageId, seq, blockIndex }))).toEqual([
            { messageId: 'multi-block-envelope', seq: 27, blockIndex: 1 },
            { messageId: 'multi-block-envelope', seq: 27, blockIndex: 2 },
        ]);
    });

    it('indexes the user-facing text rather than injected attachment instructions', () => {
        const normalized: NormalizedMessage = {
            id: 'user', localId: null, createdAt: now, role: 'user', isSidechain: false,
            content: { type: 'text', text: 'Private transport instructions and attachment paths' },
            meta: { displayText: 'Review this screenshot' },
        };
        expect(extractSearchMessages(normalized, 8).map(message => message.text)).toEqual(['Review this screenshot']);
    });

    it('includes visible reply text and excludes reasoning, tools, events and sidechains', () => {
        const normalized: NormalizedMessage = {
            id: 'reply', localId: null, createdAt: now, role: 'agent', isSidechain: false,
            content: [
                { type: 'text', text: 'The release is ready.', uuid: 'reply', parentUUID: null },
                { type: 'thinking', thinking: 'Internal reasoning', uuid: 'thinking', parentUUID: null },
                { type: 'tool-call', id: 'tool', name: 'exec_command', input: { cmd: 'secret' }, description: null, uuid: 'tool', parentUUID: null },
                { type: 'tool-result', tool_use_id: 'tool', content: 'tool output', is_error: false, uuid: 'result', parentUUID: null },
                { type: 'text', text: '   ', uuid: 'empty', parentUUID: null },
            ],
        };
        expect(extractSearchMessages(normalized, 9).map(message => message.text)).toEqual(['The release is ready.']);
        expect(extractSearchMessages({ ...normalized, isSidechain: true }, 9)).toEqual([]);
        expect(extractSearchMessages({ ...normalized, role: 'event', content: { type: 'message', message: 'Agent connected' } }, 9)).toEqual([]);
        expect(extractSearchMessages({ ...normalized, content: [{ type: 'text', text: 'Claude AI usage limit reached|1234', uuid: 'limit', parentUUID: null }] }, 9)).toEqual([]);
    });
});
