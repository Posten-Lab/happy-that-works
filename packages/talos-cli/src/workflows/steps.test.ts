import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { WorkflowDefinitionSchema, workflowProjection, type WorkflowRun, type WorkflowDecision, type WorkflowDefinition } from '@ahmadposten/talos-wire';
import { WorkflowCoordinator, type WorkflowRuntime } from './coordinator';
import { definition } from './testFixture';

const approve: WorkflowDecision = { decision: 'approve', summary: 'Verified.', document: 'Implement the assigned step.', findings: [] };
function staged(): WorkflowDefinition {
    const d = definition();
    const steps = [
        { id: randomUUID(), name: 'Plan', kind: 'plan' as const, agents: [...d.planners, { ...d.planners[0], agent: { ...d.planners[0].agent, id: 'third-planner' } }], criteria: '', checks: [] },
        { id: randomUUID(), name: 'Build', kind: 'execute' as const, agents: [d.executor], criteria: '', checks: [] },
        { id: randomUUID(), name: 'UI review', kind: 'review' as const, agents: d.reviewers, criteria: 'Review the interface', checks: [{ name: 'UI check', command: 'ui-check' }] },
        { id: randomUUID(), name: 'Polish', kind: 'execute' as const, agents: [d.executor], criteria: 'Polish the UI', checks: [] },
        { id: randomUUID(), name: 'Final review', kind: 'review' as const, agents: d.reviewers, criteria: '', checks: [] },
    ];
    return WorkflowDefinitionSchema.parse({ ...d, steps, ...workflowProjection(steps), maxTurns: 60 });
}
function setup(overrides: Partial<WorkflowRuntime> = {}, initial: WorkflowRun[] = []) {
    const saved = new Map(initial.map(r => [r.id, structuredClone(r)]));
    const runtime: WorkflowRuntime = { validate: async () => {}, prepare: async i => ({ sourceDirectory: i.directory, directory: '/isolated', baseCommit: 'base', branch: 'branch' }), version: async () => 'revision-a', turn: async () => structuredClone(approve), check: async () => ({ exitCode: 0, output: 'Passed.' }), ...overrides };
    const store = { load: () => structuredClone([...saved.values()]), save: (r: WorkflowRun) => { saved.set(r.id, structuredClone(r)); } };
    const c = new WorkflowCoordinator(store, runtime, 'machine');
    return { c, store, start: (d = staged()) => c.start({ id: randomUUID(), definition: d, task: 'Build it.', directory: '/project' }) };
}
async function until(c: WorkflowCoordinator, id: string, predicate = (r: WorkflowRun) => r.status !== 'running') {
    for (let i = 0; i < 200; i++) { const r = c.get(id); if (predicate(r)) { await new Promise(r => setTimeout(r, 5)); return c.get(id); } await new Promise(r => setTimeout(r, 5)); }
    throw new Error('Workflow did not reach expected state.');
}
describe('editable workflow stages', () => {
    it('executes every configured step in order, including reused identities, with stage-local and final checks', async () => {
        const commands: string[] = [], validated: string[] = [];
        const { c, start } = setup({ validate: async slots => { validated.push(...slots.map(s => s.agent.id)); }, check: async (_dir, command) => { commands.push(command); return { exitCode: 0, output: 'Passed' }; } });
        const d = staged(), run = await start(d), done = await until(c, run.id);
        expect(done.status).toBe('complete'); expect(done.completedSteps).toEqual(d.steps!.map(s => s.id));
        expect([...new Set(done.tasks.map(t => t.stepId))]).toEqual(d.steps!.map(s => s.id));
        expect(done.tasks.filter(t => t.stage === 'plan_vote')).toHaveLength(3);
        expect(done.tasks.filter(t => t.stage === 'execute')).toHaveLength(2);
        expect(done.tasks.filter(t => t.stage === 'review')).toHaveLength(4);
        expect(commands).toEqual(['ui-check', d.checks[0].command]);
        expect(validated).toContain('third-planner');
    });
    it('returns failed intermediate review to its preceding executor and reruns every affected gate', async () => {
        const { c, start } = setup({ turn: async (_r, t) => t.stage === 'review' && t.round === 1 && t.prompt.includes('STEP CRITERIA: Review the interface') ? { ...approve, decision: 'changes', findings: [{ title: 'Misaligned', evidence: 'Panel overflows', correction: 'Fix the panel', blocking: true }] } : approve });
        const d = staged(), run = await start(d), done = await until(c, run.id);
        expect(done.status).toBe('complete');
        expect(done.tasks.filter(t => t.stepId === d.steps![1].id)).toHaveLength(2);
        expect(done.tasks.filter(t => t.stepId === d.steps![2].id)).toHaveLength(4);
        expect(done.tasks.filter(t => t.stepId === d.steps![1].id)[1].prompt).toContain('Fix the panel');
        expect(done.stepRounds?.[d.steps![2].id]).toBe(2);
        expect(done.tasks.filter(t => t.stepId === d.steps![4].id)).toHaveLength(2);
    });
    it('does not rerun unrelated earlier stages when a later review fails', async () => {
        const d = staged();
        const { c, start } = setup({ turn: async (_r, t) => t.stepId === d.steps![4].id && t.round === 1 ? { ...approve, decision: 'changes' } : approve });
        const run = await start(d), done = await until(c, run.id);
        expect(done.status).toBe('complete');
        expect(done.tasks.filter(t => t.stepId === d.steps![1].id)).toHaveLength(1);
        expect(done.tasks.filter(t => t.stepId === d.steps![3].id)).toHaveLength(2);
        expect(done.tasks.filter(t => t.stepId === d.steps![2].id)).toHaveLength(2);
    });
    it('requires human approval at each planning step and invalidates the previous plan version', async () => {
        const d = staged(); d.steps!.splice(3, 0, { ...d.steps![0], id: randomUUID(), name: 'Plan polish' }); d.approvePlan = true;
        const { c, start } = setup(); const run = await start(d); let waiting = await until(c, run.id);
        expect(waiting.tasks.some(t => t.stage === 'execute')).toBe(false);
        await c.action({ id: run.id, expectedRevision: waiting.revision, action: 'approve_plan' });
        waiting = await until(c, run.id); expect(waiting.stepIndex).toBe(3); expect(waiting.planVersion).toBe(2);
        await c.action({ id: run.id, expectedRevision: waiting.revision, action: 'approve_plan' });
        expect((await until(c, run.id)).status).toBe('complete');
    });
    it('cannot complete or bypass failed checks when a stage exhausts its review budget', async () => {
        const { c, start } = setup({ check: async () => ({ exitCode: 1, output: 'Failed' }) });
        const d = staged(); d.reviewRounds = 1; const run = await start(d), waiting = await until(c, run.id);
        expect(waiting.status).toBe('needs_input'); expect(waiting.completedSteps).not.toContain(d.steps![2].id);
        await expect(c.action({ id: run.id, expectedRevision: waiting.revision, action: 'retry_review', note: 'Try again' })).rejects.toThrow('limit');
    });
    it('rejects stale workspace approval and requires fresh checks and every reviewer', async () => {
        let revision = 'a', changed = false;
        const { c, start } = setup({ version: async () => revision, turn: async (_r, t) => { if (t.stage === 'review' && !changed) { revision = 'b'; changed = true; } return approve; } });
        const run = await start(), waiting = await until(c, run.id); expect(waiting.reason).toContain('changed during review');
        await c.action({ id: run.id, expectedRevision: waiting.revision, action: 'retry_review', note: 'Inspected external edit' });
        const done = await until(c, run.id); expect(done.status).toBe('complete'); expect(done.artifactVersion).toBe('b');
        expect(done.tasks.filter(t => t.stage === 'review')).toHaveLength(6);
    });
    it('never advances a cancelled custom step when its in-flight turn finishes', async () => {
        let release!: () => void;
        const { c, start } = setup({ turn: async () => { await new Promise<void>(r => { release = r; }); return approve; } });
        const run = await start(), active = await until(c, run.id, r => r.tasks.length === 1);
        await c.action({ id: run.id, expectedRevision: active.revision, action: 'cancel' }); release();
        await new Promise(r => setTimeout(r, 20)); expect(c.get(run.id).status).toBe('cancelled'); expect(c.get(run.id).completedSteps).toEqual([]);
    });
    it('restores the exact interrupted stage without executing any agent on restart', async () => {
        const first = setup(); const d = staged(); d.approvePlan = true;
        const run = await first.start(d), saved = await until(first.c, run.id);
        saved.status = 'running'; saved.stepIndex = 3; saved.stage = 'execute'; saved.stepAttempt = 4;
        let calls = 0; const recovered = setup({ turn: async () => { calls++; return approve; } }, [saved]);
        expect(recovered.c.get(run.id).stepIndex).toBe(3); expect(recovered.c.get(run.id).status).toBe('needs_input'); expect(calls).toBe(0);
    });
    it('replaces an identity in all steps atomically and replans; invalid replacements leave the run untouched', async () => {
        const d = staged(); d.approvePlan = true; const { c, start } = setup(); const run = await start(d), waiting = await until(c, run.id);
        await expect(c.action({ id: run.id, expectedRevision: waiting.revision, action: 'replace_agent', agentId: d.executor.agent.id, replacement: d.reviewers[0].agent, note: 'Replace writer' })).rejects.toThrow();
        expect(c.get(run.id)).toEqual(waiting);
        await c.action({ id: run.id, expectedRevision: waiting.revision, action: 'replace_agent', agentId: d.executor.agent.id, replacement: { ...d.executor.agent, id: 'new-writer' }, note: 'Change writer' });
        const next = await until(c, run.id); expect(next.definition.steps!.filter(s => s.kind === 'execute').every(s => s.agents[0].agent.id === 'new-writer')).toBe(true); expect(next.planVersion).toBe(2);
    });
});
