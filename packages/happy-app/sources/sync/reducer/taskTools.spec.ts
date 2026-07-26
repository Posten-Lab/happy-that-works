import { describe, expect, it } from 'vitest';
import { addPendingCreate, applyCreateSubjects, createSubject, foldTaskTool, isTaskTool, parseTaskCreate, parseTaskList, stripFoldMeta, toResultText } from './taskTools';

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
        expect(stripFoldMeta(list)[0]).toEqual({ id: '1', content: 'first', status: 'completed' });
        expect(list[1].status).toBe('pending');
    });

    it('accepts a numeric taskId and can rename via subject', () => {
        const seeded = foldTaskTool([], 'TaskCreate', {}, 'Task #7 created successfully: old')!;
        const renamed = foldTaskTool(seeded, 'TaskUpdate', { taskId: 7, subject: 'new', status: 'in_progress' }, '')!;
        expect(stripFoldMeta(renamed)[0]).toEqual({ id: '7', content: 'new', status: 'in_progress' });
    });

    it('lets a TaskList refresh every task it reports', () => {
        const stale = [{ id: '1', content: 'stale', status: 'pending' as const }];
        const next = foldTaskTool(stale, 'TaskList', {}, REAL_TASK_LIST, 10)!;
        expect(next).toHaveLength(4);
        expect(next[0].status).toBe('completed');
        expect(next[0].content).toBe('Phase 0 — Plan + design spec + approval');
    });

    it('returns null when a call carries nothing usable, so state is left alone', () => {
        expect(foldTaskTool([], 'TaskList', {}, null)).toBeNull();
        expect(foldTaskTool([], 'TaskList', {}, 'no task lines here')).toBeNull();
        expect(foldTaskTool([], 'TaskCreate', {}, 'unexpected wording')).toBeNull();
        expect(foldTaskTool([], 'TaskUpdate', {}, 'x')).toBeNull();
        // An update for a task we have not seen created is NOT dropped — pages
        // arrive newest-first, so the create is usually still to come. It is
        // held as a placeholder until the create supplies the real subject.
        expect(stripFoldMeta(foldTaskTool([], 'TaskUpdate', { taskId: '9', status: 'completed' }, 'x')!))
            .toEqual([{ id: '9', content: '#9', status: 'completed' }]);
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
        expect(stripFoldMeta(next)).toEqual([
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
        expect(stripFoldMeta(next)).toEqual([
            { id: '1', content: 'Phase 0', status: 'completed' },
            { id: '4', content: 'Phase 3', status: 'in_progress' },
            { id: '6', content: 'Phase 5 [blocked by #4, #5]', status: 'pending' },
        ]);
    });

    it('still falls back to text parsing when no structured result is present', () => {
        const next = foldTaskTool([], 'TaskCreate', {}, 'Task #2 created successfully: legacy')!;
        expect(stripFoldMeta(next)).toEqual([{ id: '2', content: 'legacy', status: 'pending' }]);
    });
});

// The client fetches the newest page first and back-fills older pages, so task
// calls arrive out of order: an update before its create, and a TaskList
// snapshot after creates that postdate it. Folding must be order-independent.
describe('taskTools — out-of-order page arrival', () => {
    it('keeps an update that arrives before its create, then fills the subject', () => {
        // newest page first: the update
        let list = foldTaskTool([], 'TaskUpdate', {}, {
            taskId: '3', statusChange: { from: 'pending', to: 'completed' },
        }, 2000)!;
        expect(stripFoldMeta(list)).toEqual([{ id: '3', content: '#3', status: 'completed' }]);

        // older page: the create that introduced it
        list = foldTaskTool(list, 'TaskCreate', {}, { task: { id: '3', subject: 'real subject' } }, 1000)!;
        expect(stripFoldMeta(list)).toEqual([
            { id: '3', content: 'real subject', status: 'completed' }, // status NOT rolled back
        ]);
    });

    it('does not let an older TaskList delete tasks created after it', () => {
        // newest page: task #9 created late
        let list = foldTaskTool([], 'TaskCreate', {}, { task: { id: '9', subject: 'late task' } }, 3000)!;
        // older page: a TaskList snapshot taken before #9 existed
        list = foldTaskTool(list, 'TaskList', {}, {
            tasks: [{ id: '1', subject: 'first', status: 'completed', blockedBy: [] }],
        }, 1000)!;
        expect(stripFoldMeta(list)).toEqual([
            { id: '1', content: 'first', status: 'completed' },
            { id: '9', content: 'late task', status: 'pending' },
        ]);
    });

    it('sorts by task id regardless of arrival order', () => {
        let list = foldTaskTool([], 'TaskCreate', {}, { task: { id: '10', subject: 'ten' } }, 3000)!;
        list = foldTaskTool(list, 'TaskCreate', {}, { task: { id: '2', subject: 'two' } }, 2000)!;
        expect(list.map((t) => t.id)).toEqual(['2', '10']);
    });

    it('does not roll a status back when an older update lands later', () => {
        let list = foldTaskTool([], 'TaskUpdate', {}, { taskId: '1', statusChange: { from: 'x', to: 'completed' } }, 5000)!;
        list = foldTaskTool(list, 'TaskUpdate', {}, { taskId: '1', statusChange: { from: 'x', to: 'in_progress' } }, 1000)!;
        expect(list[0].status).toBe('completed');
    });
});


// On the real wire happy-cli does not forward these tool results: tool.result is
// null, so the subject only exists in the input and the id only arrives via
// TaskUpdate/TaskList. Verified against the live production session
// cms0plcs70003xd0tvfbaume4, where 12 creates all had result === null.
describe('taskTools — real wire (null result, subject in input)', () => {
    it('takes the subject from the input when the result is null', () => {
        expect(createSubject({ subject: 'Phase 0 — Plan', description: 'x' }, null)).toBe('Phase 0 — Plan');
        expect(createSubject({}, null)).toBeNull();
    });

    it('still prefers a structured result when one exists', () => {
        expect(createSubject({ subject: 'from input' }, { task: { id: '1', subject: 'from result' } }))
            .toBe('from result');
    });

    it('orders creates by call time and ignores replays', () => {
        let c = addPendingCreate([], 200, 'second');
        c = addPendingCreate(c, 100, 'first');
        c = addPendingCreate(c, 100, 'first'); // replayed page
        expect(c.map((x) => x.subject)).toEqual(['first', 'second']);
    });

    it('joins subjects to ids by creation order, keeping statuses from updates', () => {
        const items = [
            { id: '1', content: '#1', status: 'completed' as const, at: 10 },
            { id: '2', content: '#2', status: 'in_progress' as const, at: 20 },
        ];
        const creates = [{ at: 1, subject: 'first' }, { at: 2, subject: 'second' }];
        expect(stripFoldMeta(applyCreateSubjects(items, creates))).toEqual([
            { id: '1', content: 'first', status: 'completed' },
            { id: '2', content: 'second', status: 'in_progress' },
        ]);
    });

    it('re-derives on every pass so a partial create list self-corrects', () => {
        const items = [{ id: '1', content: '#1', status: 'pending' as const }];
        // only the newest create has loaded — it wrongly lands on id 1
        const partial = applyCreateSubjects(items, [{ at: 99, subject: 'newest' }]);
        expect(partial[0].content).toBe('newest');
        // once the older create back-fills, id 1 must become the OLDEST subject
        const full = applyCreateSubjects(partial, [{ at: 1, subject: 'oldest' }, { at: 99, subject: 'newest' }]);
        expect(full.map((t) => t.content)).toEqual(['oldest', 'newest']);
    });

    it('does not guess while creates are still missing', () => {
        // ids up to 5 are known but only one create has loaded
        const items = [{ id: '5', content: '#5', status: 'completed' as const }];
        expect(applyCreateSubjects(items, [{ at: 1, subject: 'only one' }])[0].content).toBe('#5');
    });

    it('adds rows for tasks created but never updated', () => {
        const out = applyCreateSubjects([], [{ at: 1, subject: 'a' }, { at: 2, subject: 'b' }]);
        expect(stripFoldMeta(out)).toEqual([
            { id: '1', content: 'a', status: 'pending' },
            { id: '2', content: 'b', status: 'pending' },
        ]);
    });
});
