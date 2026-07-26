import { describe, expect, it } from 'vitest';
import { RawRecordSchema, normalizeRawMessage } from '@/sync/typesRaw';
import { createReducer, reducer } from '@/sync/reducer/reducer';

/**
 * happy-cli folds every agent's task tooling into one whole-list TodoWrite.
 * This is the client half of that contract: the envelopes it emits must land in
 * session.todos, which is all the pinned panel reads.
 */
const todos = (s: string[]) => s.map((status, i) => ({ content: `step ${i + 1}`, status }));

function run(events: any[]) {
    const normalized: any[] = [];
    events.forEach((ev, i) => {
        const parsed = RawRecordSchema.safeParse({
            role: 'session',
            content: { type: 'session', data: { id: `e${i}`, time: 1000 + i, role: 'agent', turn: 't1', ev } },
        });
        if (!parsed.success) throw new Error('wire rejected: ' + JSON.stringify(parsed.error.issues[0]));
        const n = normalizeRawMessage(String(i), null, 1000 + i, parsed.data as any);
        if (n) normalized.push(n);
    });
    return reducer(createReducer(), normalized);
}

describe('folded TodoWrite envelope -> session todos', () => {
    it('populates todos from a tool-call-start/end pair', () => {
        const list = todos(['completed', 'in_progress', 'pending']);
        const r = run([
            { t: 'tool-call-start', call: 'c1', name: 'TodoWrite', title: 'Todo List', description: '', args: { todos: list } },
            { t: 'tool-call-end', call: 'c1', result: { oldTodos: [], newTodos: list } },
        ]);
        expect(r.todos).toEqual(list);
    });

    it('a later republish replaces the whole list', () => {
        const first = todos(['in_progress', 'pending']);
        const second = todos(['completed', 'in_progress']);
        const r = run([
            { t: 'tool-call-start', call: 'c1', name: 'TodoWrite', title: 'Todo List', description: '', args: { todos: first } },
            { t: 'tool-call-end', call: 'c1', result: { oldTodos: [], newTodos: first } },
            { t: 'tool-call-start', call: 'c2', name: 'TodoWrite', title: 'Todo List', description: '', args: { todos: second } },
            { t: 'tool-call-end', call: 'c2', result: { oldTodos: first, newTodos: second } },
        ]);
        expect(r.todos).toEqual(second);
    });

    it('keeps concurrent in-progress steps', () => {
        const list = todos(['in_progress', 'in_progress', 'pending']);
        const r = run([
            { t: 'tool-call-start', call: 'c1', name: 'TodoWrite', title: 'Todo List', description: '', args: { todos: list } },
            { t: 'tool-call-end', call: 'c1', result: { oldTodos: [], newTodos: list } },
        ]);
        expect(r.todos?.filter((t) => t.status === 'in_progress')).toHaveLength(2);
    });
});
