import { describe, expect, it } from 'vitest';
import { RawRecordSchema, normalizeRawMessage } from '@/sync/typesRaw';
import { createReducer, reducer } from '@/sync/reducer/reducer';

/**
 * End-to-end for Codex plans: the envelopes happy-cli emits for a
 * `turn/plan/updated` notification, pushed through the real wire schema, the
 * real normalizer and the real reducer.
 *
 * The plan payload is captured verbatim from a live `codex app-server` run —
 * note it is NOT the `todo_list` item that `codex exec --json` produces.
 */
const CALL = 'call-plan-1';

// exactly what mapCodexMcpMessageToSessionEnvelopes produces
const todos = (statuses: string[]) => [
    { content: 'Review the folder contents and identify clutter', status: statuses[0] },
    { content: 'Group related files into a clear structure', status: statuses[1] },
    { content: 'Remove or archive obsolete items', status: statuses[2] },
    { content: 'Verify the folder is tidy and consistently organized', status: statuses[3] },
];

function run(events: Array<{ ev: any }>) {
    const state = createReducer();
    const normalized: any[] = [];
    events.forEach((e, i) => {
        const wire = {
            role: 'session',
            content: {
                type: 'session',
                data: { id: `env-${i}`, time: 1000 + i, role: 'agent', turn: 'turn-1', ev: e.ev },
            },
        };
        const parsed = RawRecordSchema.safeParse(wire);
        if (!parsed.success) {
            throw new Error('wire schema rejected envelope: ' + JSON.stringify(parsed.error.issues[0]));
        }
        const n = normalizeRawMessage(String(i), null, 1000 + i, parsed.data as any);
        if (n) normalized.push(n);
    });
    return reducer(state, normalized);
}

describe('codex plan end-to-end', () => {
    it('turns a plan update into session todos with statuses preserved', () => {
        const list = todos(['completed', 'completed', 'in_progress', 'pending']);
        const result = run([
            { ev: { t: 'tool-call-start', call: CALL, name: 'TodoWrite', title: 'Todo List', description: 'Step 2 is complete', args: { todos: list } } },
            { ev: { t: 'tool-call-end', call: CALL, result: { oldTodos: [], newTodos: list } } },
        ]);

        expect(result.todos).toEqual(list);
        expect(result.todos?.filter((t) => t.status === 'in_progress')).toHaveLength(1);
    });

    it('a later plan update replaces the earlier one', () => {
        const first = todos(['in_progress', 'pending', 'pending', 'pending']);
        const second = todos(['completed', 'completed', 'in_progress', 'pending']);
        const result = run([
            { ev: { t: 'tool-call-start', call: 'c1', name: 'TodoWrite', title: 'Todo List', description: '', args: { todos: first } } },
            { ev: { t: 'tool-call-end', call: 'c1', result: { oldTodos: [], newTodos: first } } },
            { ev: { t: 'tool-call-start', call: 'c2', name: 'TodoWrite', title: 'Todo List', description: '', args: { todos: second } } },
            { ev: { t: 'tool-call-end', call: 'c2', result: { oldTodos: first, newTodos: second } } },
        ]);
        expect(result.todos).toEqual(second);
    });

    it('renders the checklist inline as well as feeding the panel', () => {
        const list = todos(['completed', 'in_progress', 'in_progress', 'pending']);
        const result = run([
            { ev: { t: 'tool-call-start', call: CALL, name: 'TodoWrite', title: 'Todo List', description: '', args: { todos: list } } },
            { ev: { t: 'tool-call-end', call: CALL, result: { oldTodos: [], newTodos: list } } },
        ]);
        const call = result.messages.find((m: any) => m.kind === 'tool-call');
        expect(call && (call as any).tool.name).toBe('TodoWrite');
        // two concurrent in-progress steps survive
        expect(result.todos?.filter((t) => t.status === 'in_progress')).toHaveLength(2);
    });
});
