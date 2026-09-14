import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { WorkflowCoordinator, type WorkflowRuntime } from './coordinator';
import { WorkflowRunSchema, WorkflowDefinitionSchema, workflowProjection, type WorkflowDefinition, type WorkflowRun, type WorkflowDecision } from '@ahmadposten/talos-wire';
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
function recoveryDefinition(staged: boolean): WorkflowDefinition {
    const d = definition();
    if (!staged) return d;
    const steps = [
        { id: randomUUID(), name: 'Plan', kind: 'plan' as const, agents: d.planners, criteria: '', checks: [] },
        { id: randomUUID(), name: 'Build', kind: 'execute' as const, agents: [d.executor], criteria: '', checks: [] },
        { id: randomUUID(), name: 'Review', kind: 'review' as const, agents: d.reviewers, criteria: '', checks: [] },
    ];
    return WorkflowDefinitionSchema.parse({ ...d, steps, ...workflowProjection(steps) });
}
describe('workflow consensus and delivery', () => {
    it.each([false, true])('switches an interrupted builder model without repeating approved planning (steps=%s)', async staged => {
        const { coordinator: c, start } = setup({ turn: async (_run, task, slot) => {
            if (task.stage === 'execute' && slot.agent.model !== 'replacement-model') throw new Error('Usage limit exceeded. Try again at 03:05.');
            return structuredClone(approve);
        } });
        const run = await start(recoveryDefinition(staged)), failed = await until(c, run.id, stopped);
        const planningTasks = failed.tasks.filter(task => task.stage !== 'execute');
        await c.action({ id: run.id, expectedRevision: failed.revision, action: 'change_model', model: 'replacement-model', effort: 'low' });
        const done = await until(c, run.id, stopped);
        expect(done.status).toBe('complete');
        expect(done.plan).toBe(failed.plan); expect(done.planVersion).toBe(failed.planVersion);
        expect(done.approvedPlanVersion).toBe(failed.approvedPlanVersion);
        expect(done.tasks.slice(0, planningTasks.length)).toEqual(planningTasks);
        const executions = done.tasks.filter(task => task.stage === 'execute');
        expect(executions).toHaveLength(2);
        expect(executions[0]).toMatchObject({ status: 'interrupted', model: failed.definition.executor.agent.model });
        expect(executions[1]).toMatchObject({ status: 'done', model: 'replacement-model', effort: 'low' });
        expect(executions[1].prompt).toContain('repair incomplete changes');
        expect(executions[1].prompt).toContain('Usage limit exceeded');
        expect(done.checks.every(check => check.exitCode === 0)).toBe(true);
    });
    it('rejects unavailable models atomically and checks revision again after discovery', async () => {
        const { coordinator: c, runtime, start } = setup({ turn: async (_run, task) => {
            if (task.stage === 'execute') throw new Error('Provider unavailable');
            return structuredClone(approve);
        } });
        const run = await start(), failed = await until(c, run.id, stopped);
        runtime.validate = async () => { throw new Error('model unavailable'); };
        const action = { id: run.id, expectedRevision: failed.revision, action: 'change_model', model: 'replacement' };
        await expect(c.action(action)).rejects.toThrow('model unavailable');
        expect(c.get(run.id)).toEqual(failed);
        let finish: () => void = () => {};
        runtime.validate = () => new Promise<void>(resolve => { finish = resolve; });
        const pending = c.action(action);
        await c.action({ id: run.id, expectedRevision: failed.revision, action: 'cancel' });
        finish();
        await expect(pending).rejects.toThrow('run changed');
        expect(c.get(run.id).status).toBe('cancelled');
        expect(c.get(run.id).definition).toEqual(failed.definition);
    });
    it('does not switch models after completed execution or while planning', async () => {
        const { coordinator: c, start } = setup({ turn: async (_run, task) => {
            if (task.stage === 'review') throw new Error('Provider unavailable');
            return structuredClone(approve);
        } });
        const run = await start(), failed = await until(c, run.id, stopped);
        await expect(c.action({ id: run.id, expectedRevision: failed.revision, action: 'change_model', model: 'replacement' })).rejects.toThrow('Only an interrupted executor');
        expect(c.get(run.id)).toEqual(failed);
    });
    it('records exact handoffs, retains planning objections, and persists explicit resolution evidence', async () => {
        const { coordinator: c, start } = setup({ turn: async (run, task) => {
            if (task.stage === 'propose') {
                expect(task.inputs).toEqual([]);
                return approve;
            }
            if (task.stage === 'plan_vote' && task.round === 1 && task.agentId === 'planner-b') return {
                ...approve, decision: 'changes', findings: [{ title: 'Retry behavior', evidence: 'No idempotency', correction: 'Require a key', blocking: true }],
            };
            const source = run.tasks.find(t => t.agentId === 'planner-b' && t.stage === 'plan_vote' && t.round === 1);
            if (source && task.round === 2 && ['consolidate', 'plan_vote'].includes(task.stage)) {
                expect(task.inputs?.some(input => input.taskId === source.id)).toBe(true);
                expect(task.prompt).toContain(`${source.id}:0`);
                if (task.stage === 'consolidate' || task.agentId === 'planner-b') return { ...approve,
                    findingResponses: [{ findingId: `${source.id}:0`, status: task.stage === 'consolidate' ? 'addressed' : 'verified', evidence: 'Idempotency added to v2.' }] };
            }
            return approve;
        } });
        const d = definition(); d.approvePlan = true;
        const started = await start(d), run = await until(c, started.id, stopped);
        expect(run.planVersion).toBe(2);
        expect(run.historyVersion).toBe(1);
        const consolidation = run.tasks.find(t => t.stage === 'consolidate' && t.round === 1)!;
        expect(consolidation.inputs).toHaveLength(2);
        expect(consolidation.participants?.map(agent => agent.id)).toEqual(['planner-a', 'planner-b']);
        const summary = WorkflowRunSchema.parse(c.view(run.id));
        expect(summary.tasks.find(t => t.agentId === 'planner-b' && t.stage === 'plan_vote' && t.round === 1)?.result?.findings[0].title).toBe('Retry behavior');
        expect(summary.tasks.find(t => t.agentId === 'planner-b' && t.stage === 'plan_vote' && t.round === 2)?.result?.findingResponses?.[0].status).toBe('verified');
        expect(summary.tasks.every(t => t.prompt === '' && !t.result?.document)).toBe(true);
        await c.shutdown();
    });

    it.each(['/project', '/project/child', '/'])('rejects overlapping direct starts at %s and retains paused claims', async directory => {
        const { coordinator: c } = setup({ prepare: async i => ({ sourceDirectory: i.directory, directory: i.directory, branch: '', baseCommit: '' }) });
        const d = definition(); d.approvePlan = true;
        const first = await c.start({ id: randomUUID(), definition: d, task: 'First', directory: '/project' });
        await until(c, first.id, stopped);
        await expect(c.start({ id: randomUUID(), definition: d, task: 'Second', directory })).rejects.toThrow('overlapping folder');
        const sibling = await c.start({ id: randomUUID(), definition: d, task: 'Sibling', directory: '/project-other' });
        expect(sibling.directory).toBe('/project-other');
        await c.shutdown();
    });
    it('only accepts one of two concurrent direct starts for the same folder', async () => {
        const { coordinator: c } = setup({ prepare: async i => ({ sourceDirectory: i.directory, directory: i.directory, branch: '', baseCommit: '' }) });
        const d = definition(); d.approvePlan = true;
        const starts = await Promise.allSettled([1, 2].map(index => c.start({ id: randomUUID(), definition: d, task: `Task ${index}`, directory: '/project' })));
        expect(starts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(starts.filter(result => result.status === 'rejected')).toHaveLength(1);
        expect(c.list()).toHaveLength(1);
        await c.shutdown();
    });
    it('keeps a cancelled direct folder claimed until the active turn finishes stopping', async () => {
        let finishStop: () => void = () => {};
        const { coordinator: c } = setup({
            prepare: async i => ({ sourceDirectory: i.directory, directory: i.directory, branch: '', baseCommit: '' }),
            turn: async (_run, _task, _slot, signal) => {
                await new Promise<void>(resolve => signal.addEventListener('abort', () => { finishStop = resolve; }, { once: true }));
                throw new Error('Stopped');
            },
        });
        const request = { definition: definition(), task: 'Build', directory: '/project' };
        const first = await c.start({ ...request, id: randomUUID() });
        const running = await until(c, first.id, r => r.tasks.length === 1);
        await c.action({ id: first.id, expectedRevision: running.revision, action: 'cancel' });
        await expect(c.start({ ...request, id: randomUUID() })).rejects.toThrow('overlapping folder');
        finishStop(); await new Promise(resolve => setTimeout(resolve, 10));
        const next = await c.start({ ...request, id: randomUUID() });
        expect(next.id).not.toBe(first.id);
        await until(c, next.id, r => r.tasks.length === 1);
        const shutdown = c.shutdown(); finishStop(); await shutdown;
    });
    it('describes direct execution accurately while retaining normal consensus and review gates', async () => {
        const { coordinator: c, start } = setup({ prepare: async i => ({ sourceDirectory: i.directory, directory: i.directory, branch: '', baseCommit: '' }) });
        const run = await start(); const done = await until(c, run.id, stopped);
        expect(done.status).toBe('complete');
        expect(done.events[0].text).toContain('selected project folder');
        expect(done.tasks.find(task => task.stage === 'execute')?.prompt).toContain('Preserve existing work');
        expect(done.tasks.find(task => task.stage === 'execute')?.prompt).not.toContain('isolated worktree');
        expect(done.checks.every(check => check.exitCode === 0 && check.version === done.artifactVersion)).toBe(true);
    });
    it('recovers an unfinished cancellation with its direct workspace claim intact', async () => {
        let finishStop: () => void = () => {};
        const overrides: Partial<WorkflowRuntime> = {
            prepare: async i => ({ sourceDirectory: i.directory, directory: i.directory, branch: '', baseCommit: '' }),
            turn: async (_run, _task, _slot, signal) => {
                await new Promise<void>(resolve => signal.addEventListener('abort', () => { finishStop = resolve; }, { once: true }));
                throw new Error('Stopped');
            },
        };
        const { coordinator: c, store, start } = setup(overrides);
        const first = await start(); const running = await until(c, first.id, run => run.tasks.length === 1);
        await c.action({ id: first.id, expectedRevision: running.revision, action: 'cancel' });
        const persisted = store.load();
        expect(persisted[0].reason).toContain('Waiting for active work to stop');
        const recovered = setup(overrides, persisted);
        expect(recovered.coordinator.get(first.id).status).toBe('needs_input');
        expect(recovered.coordinator.get(first.id).reason).toContain('before cancellation finished');
        await expect(recovered.start()).rejects.toThrow('overlapping folder');
        finishStop(); await c.shutdown(); await recovered.coordinator.shutdown();
    });
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
    describe.each([false, true])('recovery with editable stages=%s', staged => {
        it.each(['information', 'exception'] as const)('resumes a provider argument-limit %s and still requires fresh checks and independent reviews', async failure => {
            let executions = 0, checks = 0;
            const message = 'Could not start /bin/zsh: command line plus environment exceed the OS exec argument limit (E2BIG).';
            const { coordinator: c, start } = setup({
                turn: async (_run, task) => {
                    if (task.stage === 'execute') {
                        executions++;
                        if (executions === 1) {
                            if (failure === 'exception') throw new Error(message);
                            return { ...approve, decision: 'information', summary: message };
                        }
                        expect(task.prompt).toContain('I inspected the retained files. Continue with the required checks.');
                    }
                    return approve;
                },
                check: async () => { checks++; return { exitCode: 0, output: 'Required checks passed.' }; },
            });
            const run = await start(recoveryDefinition(staged));
            const waiting = await until(c, run.id, stopped);
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(waiting.reason).toBe(message);
            expect(waiting.tasks.some(task => task.stage === 'review')).toBe(false);
            expect(checks).toBe(0);
            await c.action({ id: run.id, expectedRevision: waiting.revision, action: 'resume', note: 'I inspected the retained files. Continue with the required checks.' });
            const done = await until(c, run.id, stopped);
            expect(done.status).toBe('complete');
            expect(executions).toBe(2);
            expect(checks).toBe(1);
            expect(done.tasks.filter(task => task.stage === 'review' && task.status === 'done')).toHaveLength(2);
            expect(done.tasks.filter(task => task.stage === 'plan_vote')).toHaveLength(2);
        });
        it('rejects exhausted agent turns without appending guidance or starting another task', async () => {
            const { coordinator: c, start } = setup({ turn: async (_run, task) => task.stage === 'review' ? { ...approve, decision: 'changes' } : approve });
            const d = recoveryDefinition(staged); d.maxTurns = 8;
            const run = await start(d), waiting = await until(c, run.id, stopped);
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(waiting.tasks).toHaveLength(8);
            expect(waiting.reason).toContain('Agent turn limit');
            await expect(c.action({ id: run.id, expectedRevision: waiting.revision, action: 'resume', note: 'Try once more.' })).rejects.toThrow('Agent turn limit');
            expect(c.get(run.id)).toEqual(waiting);
        });
        it('can finish a paused gate at the turn budget when all required agent work was already completed', async () => {
            const initial = setup(); const d = recoveryDefinition(staged); d.maxTurns = 8;
            const run = await initial.start(d), checkpoint = await until(initial.coordinator, run.id, stopped);
            expect(checkpoint.tasks).toHaveLength(8);
            checkpoint.status = 'paused'; checkpoint.reason = 'Paused by you.';
            let turns = 0;
            const { coordinator: c } = setup({ turn: async () => { turns++; return approve; } }, [checkpoint]);
            await c.action({ id: run.id, expectedRevision: checkpoint.revision, action: 'resume' });
            const done = await until(c, run.id, stopped);
            expect(done.status).toBe('complete');
            expect(turns).toBe(0);
            expect(done.tasks).toHaveLength(8);
        });
        it.each(['planning', 'review'] as const)('preserves the configured %s round budget on resume', async budget => {
            const { coordinator: c, start } = setup({ turn: async (_run, task) => task.stage === (budget === 'planning' ? 'plan_vote' : 'review') ? { ...approve, decision: 'changes' } : approve });
            const d = recoveryDefinition(staged); d.planningRounds = 1; d.reviewRounds = 1;
            const run = await start(d), waiting = await until(c, run.id, stopped);
            await new Promise(resolve => setTimeout(resolve, 10));
            await expect(c.action({ id: run.id, expectedRevision: waiting.revision, action: 'resume', note: 'Try once more.' })).rejects.toThrow('round limit');
            expect(c.get(run.id)).toEqual(waiting);
        });
        it('retains the exact coordinator context limit without confusing it with provider diagnostics', async () => {
            const { coordinator: c, start } = setup({ turn: async () => ({ ...approve, document: 'x'.repeat(210000) }) });
            const run = await start(recoveryDefinition(staged)), waiting = await until(c, run.id, stopped);
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(waiting.reason).toContain('Workflow context limit');
            await expect(c.action({ id: run.id, expectedRevision: waiting.revision, action: 'resume', note: 'Continue.' })).rejects.toThrow('Workflow context limit');
            expect(c.get(run.id)).toEqual(waiting);
        });
    });
    it('requires replanning when a legacy executor exhausts the planning budget', async () => {
        const { coordinator: c, start } = setup({ turn: async (_run, task) => task.stage === 'execute' ? { ...approve, decision: 'replan' } : approve });
        const d = definition(); d.planningRounds = 1;
        const run = await start(d), waiting = await until(c, run.id, stopped);
        await new Promise(resolve => setTimeout(resolve, 10));
        await expect(c.action({ id: run.id, expectedRevision: waiting.revision, action: 'resume', note: 'Try again.' })).rejects.toThrow('Planning round limit');
        expect(c.get(run.id)).toEqual(waiting);
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
