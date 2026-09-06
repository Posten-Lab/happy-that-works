import { describe, expect, it } from 'vitest';
import { resolveSessionTodos } from './sessionMerge';

const existing = [
    { content: 'Trace the bug', status: 'completed' as const },
    { content: 'Fix the merge', status: 'in_progress' as const },
];

describe('resolveSessionTodos', () => {
    it('keeps message-derived todos when a session-status update omits them', () => {
        expect(resolveSessionTodos(undefined, existing)).toBe(existing);
    });

    it('accepts an explicitly supplied replacement, including an empty list', () => {
        const replacement = [{ content: 'Verify the fix', status: 'pending' as const }];

        expect(resolveSessionTodos(replacement, existing)).toBe(replacement);
        expect(resolveSessionTodos([], existing)).toEqual([]);
    });
});
