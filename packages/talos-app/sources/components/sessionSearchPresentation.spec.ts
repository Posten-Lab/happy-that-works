import { describe, expect, it } from 'vitest';
import { createReducer, reducer } from '@/sync/reducer/reducer';
import { highlightSearchText, invertedSearchOffset, resolveSearchMessageId, searchExcerpt } from './sessionSearchPresentation';

describe('search result presentation', () => {
    it('corrects the measured position of an older row in an inverted viewport', () => {
        expect(invertedSearchOffset(12_000, 100, 500, -400, 100)).toBe(12_700);
        expect(invertedSearchOffset(12_700, 100, 500, 300, 100)).toBe(12_700);
        expect(invertedSearchOffset(200, 100, 500, 700, 100)).toBe(0);
        expect(invertedSearchOffset(1000, 100, 500, 100, 1000)).toBe(1000);
    });
    it('shows a query match deep inside a long message instead of truncating it away', () => {
        const excerpt = searchExcerpt(`${'Unrelated context. '.repeat(80)}Investigate npm publishing credentials and release this package.`, 'npm publishing');
        expect(excerpt).toContain('npm publishing');
        expect(excerpt.startsWith('…')).toBe(true);
        expect(excerpt.length).toBeLessThanOrEqual(182);
    });

    it('highlights unicode and prefix matches without interpreting regex punctuation', () => {
        expect(highlightSearchText('Überblick: publishing packages [v2]', 'über pub [v2]')).toEqual([
            { text: 'Über', highlighted: true },
            { text: 'blick: ', highlighted: false },
            { text: 'pub', highlighted: true },
            { text: 'lishing packages [', highlighted: false },
            { text: 'v2', highlighted: true },
            { text: ']', highlighted: false },
        ]);
    });

    it('resolves normalized user IDs to allocated reducer display IDs', () => {
        const state = createReducer();
        const result = reducer(state, [{ id: 'raw-user', localId: null, createdAt: 1, role: 'user', content: { type: 'text', text: 'Find the release credentials' }, isSidechain: false }], null);
        expect(resolveSearchMessageId(state, 'raw-user', 'release')).toBe(result.messages[0].id);
        expect(result.messages[0].id).not.toBe('raw-user');
    });

    it('chooses the matching agent block and skips thinking blocks sharing one source ID', () => {
        const state = createReducer();
        const result = reducer(state, [{
            id: 'raw-agent', localId: null, createdAt: 2, role: 'agent', isSidechain: false,
            content: [
                { type: 'text', text: 'Preliminary answer', uuid: 'agent-uuid', parentUUID: null },
                { type: 'thinking', thinking: 'publishing credentials', uuid: 'agent-uuid', parentUUID: null },
                { type: 'text', text: 'The publishing credentials are ready', uuid: 'agent-uuid', parentUUID: null },
            ],
        }], null);
        const expected = result.messages.find((message) => message.kind === 'agent-text' && message.text === 'The publishing credentials are ready');
        expect(resolveSearchMessageId(state, 'raw-agent', 'publishing credentials')).toBe(expected?.id);
        expect(resolveSearchMessageId(state, 'raw-agent', 'publshing credntials', 1)).toBe(expected?.id);
    });
});
