import { describe, expect, it } from 'vitest';
import { foldTaskTool, isTaskTool, parseTaskCreate, parseTaskList, toResultText } from './taskTools';

// Verbatim payloads captured from session ba91de6b (Claude Code 2.1.210/2.1.220).
const REAL_TASK_LIST = [
    '#1 [completed] Phase 0 — Plan + design spec + approval',
    '#2 [completed] Phase 1 — Parallel execution (backend + mobile worktrees)',
    '#4 [in_progress] Phase 3 — UI review panel (Codex, 3 lenses, cap 5)',
    '#6 [pending] Phase 5 — All-suites-green + open both PRs [blocked by #4, #5]',
].join('\n');

const REAL_TASK_CREATE = 'Task #1 created successfully: Phase 0 — Plan + design spec + approval';

describe('taskTools', () => {
    it('recognises the Task* family and nothing else', () => {
        expect(isTaskTool('TaskCreate')).toBe(true);
        expect(isTaskTool('TaskUpdate')).toBe(true);
        expect(isTaskTool('TaskList')).toBe(true);
        // `Task` is the sub-agent spawn tool — unrelated, already rendered.
        expect(isTaskTool('Task')).toBe(false);
        expect(isTaskTool('TodoWrite')).toBe(false);
    });

    it('parses a real TaskList result, keeping ids, statuses and blocked-by text', () => {
        expect(parseTaskList(REAL_TASK_LIST)).toEqual([
            { id: '1', content: 'Phase 0 — Plan + design spec + approval', status: 'completed' },
            { id: '2', content: 'Phase 1 — Parallel execution (backend + mobile worktrees)', status: 'completed' },
            { id: '4', content: 'Phase 3 — UI review panel (Codex, 3 lenses, cap 5)', status: 'in_progress' },
            { id: '6', content: 'Phase 5 — All-suites-green + open both PRs [blocked by #4, #5]', status: 'pending' },
        ]);
    });

    it('keeps every concurrent in_progress task (no single-active assumption)', () => {
        const list = parseTaskList([
            '#4 [in_progress] four',
            '#5 [in_progress] five',
            '#8 [in_progress] eight',
        ].join('\n'));
        expect(list.filter((t) => t.status === 'in_progress')).toHaveLength(3);
    });

    it('ignores non-task lines and unknown statuses', () => {
        const list = parseTaskList('preamble\n#1 [weird] one\n\ntrailing');
        expect(list).toEqual([{ id: '1', content: 'one', status: 'pending' }]);
    });

    it('parses a real TaskCreate result', () => {
        expect(parseTaskCreate(REAL_TASK_CREATE)).toEqual({
            id: '1',
            content: 'Phase 0 — Plan + design spec + approval',
            status: 'pending',
        });
        expect(parseTaskCreate('Updated task #1 status')).toBeNull();
    });

    it('normalises result shapes to text', () => {
        expect(toResultText('plain')).toBe('plain');
        expect(toResultText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('a\nb');
        expect(toResultText({ content: 'wrapped' })).toBe('wrapped');
        expect(toResultText(null)).toBeNull();
        expect(toResultText({ nothing: true })).toBeNull();
    });

    it('builds a list incrementally from create + update, without a TaskList call', () => {
        let list = foldTaskTool([], 'TaskCreate', {}, 'Task #1 created successfully: first')!;
        list = foldTaskTool(list, 'TaskCreate', {}, 'Task #2 created successfully: second')!;
        expect(list.map((t) => t.content)).toEqual(['first', 'second']);

        list = foldTaskTool(list, 'TaskUpdate', { taskId: '1', status: 'completed' }, 'Updated task #1 status')!;
        expect(list[0]).toEqual({ id: '1', content: 'first', status: 'completed' });
        expect(list[1].status).toBe('pending');
    });

    it('accepts a numeric taskId and can rename via subject', () => {
        const seeded = foldTaskTool([], 'TaskCreate', {}, 'Task #7 created successfully: old')!;
        const renamed = foldTaskTool(seeded, 'TaskUpdate', { taskId: 7, subject: 'new', status: 'in_progress' }, '')!;
        expect(renamed[0]).toEqual({ id: '7', content: 'new', status: 'in_progress' });
    });

    it('lets TaskList replace the list wholesale', () => {
        const stale = [{ id: '1', content: 'stale', status: 'pending' as const }];
        const next = foldTaskTool(stale, 'TaskList', {}, REAL_TASK_LIST)!;
        expect(next).toHaveLength(4);
        expect(next[0].status).toBe('completed');
    });

    it('returns null when a call carries nothing usable, so state is left alone', () => {
        expect(foldTaskTool([], 'TaskList', {}, null)).toBeNull();
        expect(foldTaskTool([], 'TaskList', {}, 'no task lines here')).toBeNull();
        expect(foldTaskTool([], 'TaskCreate', {}, 'unexpected wording')).toBeNull();
        expect(foldTaskTool([], 'TaskUpdate', {}, 'x')).toBeNull();
        // update for a task we never saw created
        expect(foldTaskTool([], 'TaskUpdate', { taskId: '9', status: 'completed' }, 'x')).toBeNull();
        expect(foldTaskTool([], 'TodoWrite', {}, 'x')).toBeNull();
    });

    it('does not duplicate a task when a create is retried', () => {
        const first = foldTaskTool([], 'TaskCreate', {}, REAL_TASK_CREATE)!;
        const retried = foldTaskTool(first, 'TaskCreate', {}, REAL_TASK_CREATE)!;
        expect(retried).toHaveLength(1);
    });
});

// Claude Code reports these results twice: readable text, and a structured
// `toolUseResult` that the wire normalizer prefers — so the structured shape is
// what actually reaches the reducer. Payloads verbatim from session ba91de6b.
describe('taskTools — structured toolUseResult (what the reducer actually sees)', () => {
    it('folds a structured TaskCreate result', () => {
        const next = foldTaskTool([], 'TaskCreate', { subject: 'x' }, {
            task: { id: '1', subject: 'Phase 0 — Plan + design spec + approval' },
        })!;
        expect(next).toEqual([
            { id: '1', content: 'Phase 0 — Plan + design spec + approval', status: 'pending' },
        ]);
    });

    it('folds a structured TaskUpdate result, preferring statusChange.to', () => {
        const seeded = foldTaskTool([], 'TaskCreate', {}, { task: { id: '1', subject: 'first' } })!;
        const next = foldTaskTool(seeded, 'TaskUpdate', {}, {
            success: true, taskId: '1', updatedFields: ['status'],
            statusChange: { from: 'pending', to: 'completed' },
        })!;
        expect(next[0].status).toBe('completed');
    });

    it('folds a structured TaskList result and renders blockedBy edges', () => {
        const next = foldTaskTool([], 'TaskList', {}, {
            tasks: [
                { id: '1', subject: 'Phase 0', status: 'completed', blockedBy: [] },
                { id: '4', subject: 'Phase 3', status: 'in_progress', blockedBy: [] },
                { id: '6', subject: 'Phase 5', status: 'pending', blockedBy: ['4', '5'] },
            ],
        })!;
        expect(next).toEqual([
            { id: '1', content: 'Phase 0', status: 'completed' },
            { id: '4', content: 'Phase 3', status: 'in_progress' },
            { id: '6', content: 'Phase 5 [blocked by #4, #5]', status: 'pending' },
        ]);
    });

    it('still falls back to text parsing when no structured result is present', () => {
        const next = foldTaskTool([], 'TaskCreate', {}, 'Task #2 created successfully: legacy')!;
        expect(next).toEqual([{ id: '2', content: 'legacy', status: 'pending' }]);
    });
});
