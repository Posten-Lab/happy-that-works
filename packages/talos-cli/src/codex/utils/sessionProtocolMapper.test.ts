import { describe, expect, it } from 'vitest';
import { mapCodexMcpMessageToSessionEnvelopes } from './sessionProtocolMapper';


// Payload captured from a live `codex app-server` run. The plan is NOT an item
// (that is the `codex exec --json` shape) — it arrives as turn/plan/updated
// carrying the whole plan, with camelCase statuses.
describe('codex plan -> todo list', () => {
    const state = () => ({
        currentTurnId: 'turn-1',
        startedSubagents: new Set<string>(),
        activeSubagents: new Set<string>(),
        providerSubagentToSessionSubagent: new Map<string, string>(),
    });

    const REAL_PLAN = [
        { step: 'Review the folder contents and identify clutter', status: 'completed' },
        { step: 'Group related files into a clear structure', status: 'completed' },
        { step: 'Remove or archive obsolete items', status: 'inProgress' },
        { step: 'Verify the folder is tidy and consistently organized', status: 'pending' },
    ];

    it('maps a real plan update to a TodoWrite call carrying every step', () => {
        const out = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'plan_updated', plan: REAL_PLAN, explanation: 'Step 2 is complete' } as any, state());

        const start = out.envelopes.find((e) => e.ev.t === 'tool-call-start') as any;
        const end = out.envelopes.find((e) => e.ev.t === 'tool-call-end') as any;
        expect(start.ev.name).toBe('TodoWrite');
        expect(start.ev.description).toBe('Step 2 is complete');
        expect(end.ev.call).toBe(start.ev.call);
        expect(end.ev.result.newTodos).toEqual([
            { content: 'Review the folder contents and identify clutter', status: 'completed' },
            { content: 'Group related files into a clear structure', status: 'completed' },
            { content: 'Remove or archive obsolete items', status: 'in_progress' },
            { content: 'Verify the folder is tidy and consistently organized', status: 'pending' },
        ]);
    });

    it('assigns one synthetic protocol turn when a plan arrives after the active turn cleared', () => {
        const out = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'plan_updated', plan: REAL_PLAN } as any,
            { ...state(), currentTurnId: null },
        );

        expect(out.currentTurnId).toBeNull();
        expect(out.envelopes).toHaveLength(2);
        expect(out.envelopes[0].turn).toBeTruthy();
        expect(out.envelopes[1].turn).toBe(out.envelopes[0].turn);
    });

    it('assigns a synthetic protocol turn when the final response arrives after completion', () => {
        const out = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'agent_message', message: 'Approve the reviewed plan?\n\n<options>...</options>' } as any,
            { ...state(), currentTurnId: null },
        );

        expect(out.currentTurnId).toBeNull();
        expect(out.envelopes).toHaveLength(1);
        expect(out.envelopes[0]).toMatchObject({
            role: 'agent',
            turn: expect.any(String),
            ev: { t: 'text', text: expect.stringContaining('Approve the reviewed plan?') },
        });
    });

    it('translates camelCase inProgress and treats unknown statuses as pending', () => {
        const out = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'plan_updated', plan: [
                { step: 'a', status: 'inProgress' },
                { step: 'b', status: 'in_progress' },
                { step: 'c', status: 'weird' },
                { step: 'd' },
            ] } as any, state());
        const end = out.envelopes.find((e) => e.ev.t === 'tool-call-end') as any;
        expect(end.ev.result.newTodos.map((t: any) => t.status))
            .toEqual(['in_progress', 'in_progress', 'pending', 'pending']);
    });

    it('keeps every concurrent in-progress step', () => {
        const out = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'plan_updated', plan: [
                { step: 'a', status: 'inProgress' }, { step: 'b', status: 'inProgress' },
            ] } as any, state());
        const end = out.envelopes.find((e) => e.ev.t === 'tool-call-end') as any;
        expect(end.ev.result.newTodos.filter((t: any) => t.status === 'in_progress')).toHaveLength(2);
    });

    it('emits nothing for an empty or malformed plan', () => {
        expect(mapCodexMcpMessageToSessionEnvelopes({ type: 'plan_updated', plan: [] } as any, state()).envelopes)
            .toEqual([]);
        expect(mapCodexMcpMessageToSessionEnvelopes({ type: 'plan_updated' } as any, state()).envelopes)
            .toEqual([]);
        expect(mapCodexMcpMessageToSessionEnvelopes(
            { type: 'plan_updated', plan: [{ notAStep: 1 }] } as any, state()).envelopes).toEqual([]);
    });
});
