import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { WorkflowCoordinator, type WorkflowRuntime } from './coordinator';
import type { WorkflowDefinition, WorkflowRun, WorkflowDecision } from '@ahmadposten/talos-wire';
import { definition } from './testFixture';

const approve: WorkflowDecision = { decision: 'approve', summary: 'Verified.', document: 'Implement the requested result.', findings: [] };
function setup(overrides: Partial<WorkflowRuntime> = {}, initial: WorkflowRun[] = []) {
    let saved = structuredClone(initial);
    const store = { load: () => structuredClone(saved), save: (r: WorkflowRun) => { saved = [...saved.filter(x => x.id !== r.id), structuredClone(r)]; } };
    const runtime: WorkflowRuntime = { validate: async () => {}, prepare: async i => ({ sourceDirectory: i.directory, directory: '/isolated', baseCommit: 'base', branch: 'branch' }), version: async () => 'revision-a', turn: async () => structuredClone(approve), check: async () => ({ exitCode: 0, output: 'Passed.' }), ...overrides };
    const coordinator = new WorkflowCoordinator(store, runtime, 'machine');
    const start = (d = definition()) => coordinator.start({ id: randomUUID(), definition: d, task: 'Build it.', directory: '/project' });
    return { coordinator, store, runtime, start };
}
async function until(c: WorkflowCoordinator, id: string, predicate: (r: WorkflowRun) => boolean) {
    for (let i = 0; i < 200; i++) { const r = c.get(id); if (predicate(r)) return r; await new Promise(r => setTimeout(r, 5)); }
    throw new Error('Workflow did not reach expected state.');
}
const stopped = (r: WorkflowRun) => r.status !== 'running';
describe('workflow consensus and delivery', () => {
    it('rejects conflicting requests while a run is still being prepared', async () => {
        let release: () => void = () => {};
        let firstValidation = true;
        const { coordinator: c } = setup({ validate: async () => { if (firstValidation) { firstValidation = false; await new Promise<void>(resolve => { release = resolve; }); } } });
        const request = { id: randomUUID(), definition: definition(), task: 'Build it.', directory: '/project' };
        const first = c.start(request);
        await expect(c.start({ ...request, task: 'Different request' })).rejects.toThrow('different request');
        release(); const run = await first;
        expect(run.id).toBe(request.id); await c.shutdown();
    });
    it('isolates unreadable or unwritable recovery state without crashing the machine daemon', () => {
        const { runtime } = setup();
        const c = new WorkflowCoordinator({ load: () => { throw new Error('Corrupt state'); }, save: () => {} }, runtime, 'machine');
        expect(() => c.list()).toThrow('Workflows are disabled');
    });
    it('fails closed on a checkpoint write failure and recovers without replaying the uncertain turn', async () => {
        let fail = false;
        const base = setup({ turn: async () => { fail = true; return approve; } });
        const store = { load: base.store.load, save: (r: WorkflowRun) => { if (fail) throw new Error('Disk unavailable'); base.store.save(r); } };
        const c = new WorkflowCoordinator(store, base.runtime, 'machine');
        await c.start({ id: randomUUID(), definition: definition(), task: 'Build it.', directory: '/project' });
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(() => c.list()).toThrow('Workflows are disabled');
        fail = false;
        const recovered = new WorkflowCoordinator(store, base.runtime, 'machine');
        expect(recovered.list()[0].status).toBe('needs_input');
        expect(recovered.get(recovered.list()[0].id).tasks[0].status).toBe('interrupted');
    });
    it('awaits interrupted participant cleanup before handing off coordinator ownership', async () => {
        let cleaned = false;
        const { coordinator: c, start, store } = setup({ turn: async (_run, _task, _slot, signal) => {
            await new Promise<void>(resolve => signal.addEventListener('abort', () => setTimeout(resolve, 30), { once: true }));
            cleaned = true;
            throw new Error('Interrupted after evidence flush');
        } });
        const run = await start(); await until(c, run.id, r => r.tasks.length === 1);
        await c.shutdown();
        expect(cleaned).toBe(true);
        expect(store.load()[0].tasks[0].status).toBe('interrupted');
        expect(store.load()[0].status).toBe('paused');
    });
    it('retains the original start path for retries after workspace canonicalization', async () => {
        const { coordinator: c } = setup({ prepare: async () => ({ sourceDirectory: '/canonical', directory: '/isolated', baseCommit: 'base', branch: 'branch' }) });
        const request = { id: randomUUID(), definition: definition(), task: 'Build it.', directory: '/symlink/' };
        const first = await c.start(request); const retry = await c.start(request);
        expect(retry.id).toBe(first.id); await c.shutdown();
    });
    it('rejects oversized participant replacements without mutating or disabling any run', async () => {
        const { coordinator: c, start } = setup(); const d = definition(); d.approvePlan = true;
        const run = await start(d); const waiting = await until(c, run.id, stopped); await new Promise(resolve => setTimeout(resolve, 10));
        const replacement = { ...d.executor.agent, id: 'replacement', instructions: 'x'.repeat(24000), documents: Array.from({ length: 5 }, (_, i) => ({ name: String(i), content: 'y'.repeat(16000) })) };
        await expect(c.action({ id: run.id, expectedRevision: waiting.revision, action: 'replace_agent', note: 'Replace executor', agentId: d.executor.agent.id, replacement })).rejects.toThrow('64 KB');
        expect(c.get(run.id)).toEqual(waiting); expect(c.list()).toHaveLength(1);
    });
    it('requires two independent proposals, every vote, one executor, every review and successful checks', async () => {
        const { coordinator: c, start } = setup(); const run = await start(); const done = await until(c, run.id, stopped);
        expect(done.status).toBe('complete');
        expect(done.tasks.map(t => t.stage)).toEqual(['propose','propose','consolidate','plan_vote','plan_vote','execute','review','review']);
        expect(done.tasks[1].prompt).not.toContain('Implement the requested result.');
        expect(done.tasks.filter(t => t.stage === 'review').every(t => t.version === done.artifactVersion)).toBe(true);
        expect(done.checks[0].exitCode).toBe(0);
        expect(done.tasks.find(t => t.stage === 'execute')?.prompt).toContain(done.definition.checks[0].command);
    });
    it('does not advance on majority approval or carry votes to a revised plan', async () => {
        const { coordinator: c, start } = setup({ turn: async (_r,t) => t.stage === 'plan_vote' && t.agentId === 'planner-b' && t.round === 1 ? { ...approve, decision: 'changes', summary: 'Missing rollback.' } : approve });
        const r = await start(); const done = await until(c,r.id,stopped);
        expect(done.status).toBe('complete'); expect(done.planVersion).toBe(2);
        expect(done.tasks.filter(t => t.stage === 'plan_vote')).toHaveLength(4);
        expect(done.tasks.find(t => t.stage === 'execute')?.version).toBe('plan:2');
    });
    it('executes corrections and asks every reviewer again on the new round', async () => {
        const { coordinator: c, start } = setup({ turn: async (_r,t) => t.stage === 'review' && t.agentId === 'reviewer-b' && t.round === 1 ? { ...approve, decision: 'changes', findings: [{ title: 'Broken output', evidence: 'Wrong bytes', correction: 'Correct result.txt', blocking: true }] } : approve });
        const r = await start(); const done = await until(c,r.id,stopped);
        expect(done.status).toBe('complete'); expect(done.tasks.filter(t => t.stage === 'review')).toHaveLength(4);
        expect(done.tasks.filter(t => t.stage === 'execute')[1].prompt).toContain('Correct result.txt');
        expect(done.tasks.filter(t => t.stage === 'review' && t.round === 2).every(t => t.prompt.includes('Correct result.txt'))).toBe(true);
    });
    it('cannot complete when checks fail even if all reviewers approve', async () => {
        const { coordinator: c, start } = setup({ check: async () => ({ exitCode: 1, output: 'Actual check failure' }) });
        const d = definition(); d.reviewRounds = 1; const r = await start(d); const done = await until(c,r.id,stopped);
        expect(done.status).toBe('needs_input'); expect(done.reason).toContain('limit');
    });
    it('invalidates approvals if workspace contents change during review', async () => {
        let revision = 'first'; const { coordinator: c, start } = setup({ version: async () => revision, turn: async (_r,t) => { if (t.stage === 'review') revision = 'changed'; return approve; } });
        const r = await start(); const done = await until(c,r.id,stopped); expect(done.status).toBe('needs_input'); expect(done.reason).toContain('changed during review');
    });
    it('requires optional human approval only after unanimous plan votes', async () => {
        const { coordinator: c, start } = setup(); const d = definition(); d.approvePlan = true;
        const r = await start(d); let waiting = await until(c,r.id,stopped);
        expect(waiting.tasks.some(t => t.stage === 'execute')).toBe(false);
        await new Promise(r => setTimeout(r, 10));
        await c.action({ id:r.id, expectedRevision:waiting.revision, action:'approve_plan' });
        waiting = await until(c,r.id,stopped); expect(waiting.status).toBe('complete');
    });
    it('pauses disagreement at the configured limit and cannot bypass it with review', async () => {
        const { coordinator: c, start } = setup({ turn: async (_r,t) => t.stage === 'plan_vote' ? { ...approve, decision:'changes' } : approve });
        const d = definition(); d.planningRounds = 1; const r = await start(d); const blocked = await until(c,r.id,stopped); await new Promise(r => setTimeout(r, 10));
        expect(blocked.status).toBe('needs_input');
        await expect(c.action({ id:r.id, expectedRevision:blocked.revision, action:'retry_review', note:'Bypass planning' })).rejects.toThrow('approved plan');
        await expect(c.action({ id:r.id, expectedRevision:blocked.revision, action:'approve_plan' })).rejects.toThrow('Every planner');
    });
    it('persists cancellation and never advances after an in-flight turn settles', async () => {
        let release: () => void = () => {};
        const { coordinator: c, start } = setup({ turn: async () => { await new Promise<void>(r => release=r); return approve; } });
        const r = await start(); const active = await until(c,r.id,x => x.tasks.length === 1);
        await c.action({ id:r.id, expectedRevision:active.revision, action:'cancel' }); release(); await new Promise(r => setTimeout(r,20));
        expect(c.get(r.id).status).toBe('cancelled'); expect(c.get(r.id).tasks).toHaveLength(1);
    });
    it('rejects stale user decisions', async () => {
        const { coordinator: c, start } = setup(); const d = definition(); d.approvePlan=true; const r=await start(d); await until(c,r.id,stopped);
        await expect(c.action({id:r.id, expectedRevision:0,action:'cancel'})).rejects.toThrow('changed');
    });
    it('recovers a stopped coordinator without replaying execution', async () => {
        const first = setup(); const d=definition(); d.approvePlan=true; const r=await first.start(d); const saved=await until(first.coordinator,r.id,stopped);
        saved.status='running'; saved.stage='execute'; saved.tasks.push({id:'interrupted',stage:'execute',round:1,version:'plan:1',agentId:'executor',agentName:'executor',assignment:'Execute',status:'running',startedAt:1,prompt:'Execute'});
        let turns=0; const recovered=setup({turn:async()=>{turns++;return approve;}},[saved]);
        expect(recovered.coordinator.get(r.id).status).toBe('needs_input'); expect(recovered.coordinator.get(r.id).tasks.at(-1)?.status).toBe('interrupted'); expect(turns).toBe(0);
    });
    it('delivers clarification to a new executor attempt instead of replaying the cached question', async () => {
        let asked = false;
        const { coordinator: c, start } = setup({ turn: async (_r,t) => {
            if (t.stage === 'execute' && !asked) { asked=true; return { ...approve, decision:'information', summary:'Which format?' }; }
            if (t.stage === 'execute') expect(t.prompt).toContain('Use plain text.');
            return approve;
        } });
        const r=await start(); const waiting=await until(c,r.id,stopped); await new Promise(r=>setTimeout(r,10));
        await c.action({ id:r.id, expectedRevision:waiting.revision, action:'resume', note:'Use plain text.' });
        const done=await until(c,r.id,stopped); expect(done.status).toBe('complete'); expect(done.tasks.filter(t=>t.stage==='execute')).toHaveLength(2);
    });
    it('reconciles a definitively rejected start without creating a run', async () => {
        const {coordinator:c}=setup({ prepare:async()=>{throw new Error('Invalid path');} });
        const id=randomUUID(); await expect(c.start({id,definition:definition(),task:'Task',directory:'/invalid'})).rejects.toThrow('Invalid path');
        expect(c.startStatus(id)).toEqual({state:'absent'});
    });
    it('reuses start request identity and rejects changed parameters', async () => {
        const {coordinator:c}=setup();const request={id:randomUUID(),definition:definition(),task:'Task',directory:'/project'};
        const a=await c.start(request), b=await c.start(request);expect(a.id).toBe(b.id);expect(c.list()).toHaveLength(1);
        await expect(c.start({...request,task:'Other task'})).rejects.toThrow('different request');
    });
});
