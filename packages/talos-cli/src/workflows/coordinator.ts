import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { WorkflowActionSchema, WorkflowStartSchema, WorkflowRunSchema, WorkflowDefinitionSchema, workflowSlots, workflowProjection, workflowRecoverableExecutor, workflowFindingId, validWorkflowResponses, type WorkflowRun, type WorkflowSlot, type WorkflowTask, type WorkflowDecision } from '@ahmadposten/talos-wire';

type Start = ReturnType<typeof WorkflowStartSchema.parse>;
export interface WorkflowRuntime {
    prepare(input: Start): Promise<Pick<WorkflowRun, 'sourceDirectory' | 'directory' | 'branch' | 'baseCommit'>>;
    validate(slots: WorkflowSlot[]): Promise<void>;
    version(directory: string): Promise<string>;
    turn(run: WorkflowRun, task: WorkflowTask, slot: WorkflowSlot, signal: AbortSignal, checkpoint: () => void): Promise<WorkflowDecision>;
    check(directory: string, command: string, signal: AbortSignal): Promise<{ exitCode: number | null; output: string }>;
}
export interface RunStore { load(): WorkflowRun[]; save(run: WorkflowRun): void }
const terminal = (r: WorkflowRun) => r.status === 'complete' || r.status === 'cancelled';
const agentTurnLimit = 'Agent turn limit reached. Completed work is retained.';
const workflowContextLimit = 'Workflow context limit reached. Start a new run with a shorter task and instructions.';
// Persisted cancellation receipt: do not release a direct folder claim merely
// because the daemon died before its active turn/check finished cleaning up.
const cancellationPending = 'Cancelled by you. Waiting for active work to stop; workspace and evidence retained.';
const cancellationComplete = 'Cancelled by you. Workspace and evidence retained.';
function overlappingDirectories(left: string, right: string): boolean {
    const canonical = (path: string) => { try { return realpathSync(path); } catch { return resolve(path); } };
    const distance = relative(canonical(left), canonical(right));
    const reverse = relative(canonical(right), canonical(left));
    const inside = (path: string) => path === '' || path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
    return inside(distance) || inside(reverse);
}
export class WorkflowCoordinator {
    private runs = new Map<string, WorkflowRun>();
    private active = new Map<string, AbortController>();
    private starting = new Map<string, { request: string; promise: Promise<WorkflowRun> }>();
    private closed = false;
    private settled = false;
    private operations = new Set<Promise<void>>();
    private loadError = false;
    constructor(private store: RunStore, private runtime: WorkflowRuntime, private machineId: string) {
        let saved: WorkflowRun[];
        try { saved = store.load();
        for (const run of saved) {
            if (run.status === 'running' || run.status === 'cancelled' && run.reason === cancellationPending) {
                const wasStopping = run.status === 'cancelled';
                run.status = 'needs_input'; run.reason = wasStopping
                    ? 'Coordinator restarted before cancellation finished. Inspect participant sessions and stop any remaining work before cancelling or resuming; the workspace remains reserved.'
                    : 'Coordinator restarted. Inspect any interrupted work before resuming; no execution was replayed.';
                for (const task of run.tasks) if (task.status === 'running') { task.status = 'interrupted'; task.error = run.reason; }
                this.persist(run, run.reason);
            }
            this.runs.set(run.id, run);
        }
        } catch { this.loadError = true; this.runs.clear(); }
    }
    private persist(run: WorkflowRun, event?: string) {
        if (this.settled) throw new Error('Coordinator shutdown completed; late workflow writes are disabled.');
        if (event) run.events.push({ at: Date.now(), text: event });
        run.events = run.events.slice(-500);
        run.updatedAt = Date.now(); run.revision++;
        try { this.store.save(run); } catch (error) {
            this.loadError = true; this.closed = true;
            for (const abort of this.active.values()) abort.abort();
            throw error;
        }
    }
    private readable() { if (this.loadError) throw new Error('Saved workflow state could not be read. Workflows are disabled; existing files are preserved for recovery.'); }
    list() { this.readable(); return [...this.runs.values()].sort((a, b) => b.createdAt - a.createdAt).map(r => ({ id: r.id, name: r.definition.name, task: r.task, status: r.status, stage: r.stage, updatedAt: r.updatedAt, machineId: r.machineId })); }
    get(id: string) { this.readable(); const r = this.runs.get(id); if (!r) throw new Error('Workflow run not found'); return structuredClone(r); }
    view(id: string) {
        const run = this.get(id);
        const clip = (value: string, length: number) => value.length > length ? value.slice(0, length) + '\n[Preview shortened. Open task details for full evidence.]' : value;
        run.tasks = run.tasks.map(t => ({ ...t, assignment: '', prompt: '', result: t.result ? { ...t.result, document: '',
            findings: t.stage === 'review' && t.round === run.reviewRound && (!run.definition.steps || t.stepId === run.definition.steps[run.stepIndex ?? 0]?.id && t.attempt === run.stepAttempt) ? t.result.findings : t.result.findings.map(f => ({ ...f, evidence: clip(f.evidence, 300), correction: clip(f.correction, 300) })) } : undefined }));
        run.events = run.events.slice(-100);
        run.notes = run.notes.slice(-5);
        for (const length of [2000, 500, 100]) {
            for (const t of run.tasks) {
                if (t.error) t.error = clip(t.error, length);
                if (!t.result) continue;
                t.result.summary = clip(t.result.summary, length);
                t.result.findingResponses = t.result.findingResponses?.map(response => ({ ...response, evidence: clip(response.evidence, length) }));
                t.result.findings = t.result.findings.map(f => ({ ...f, evidence: clip(f.evidence, length), correction: clip(f.correction, length) }));
            }
            run.events = run.events.map(e => ({ ...e, text: clip(e.text, length) }));
            run.notes = run.notes.map(n => clip(n, length));
            run.checks = run.checks.map(c => ({ ...c, output: clip(c.output, length) }));
            if (Buffer.byteLength(JSON.stringify(run)) <= 480000) break;
        }
        return run;
    }
    task(id: string, taskId: string) {
        this.readable();
        const task = this.runs.get(id)?.tasks.find(t => t.id === taskId);
        if (!task) throw new Error('Workflow task not found');
        return structuredClone(task);
    }
    async start(raw: unknown): Promise<WorkflowRun> {
        this.readable();
        const input = WorkflowStartSchema.parse(raw);
        const existing = this.runs.get(input.id);
        if (existing) {
            const sameDirectory = existing.requestedDirectory === input.directory || existing.sourceDirectory === input.directory || existing.sourceDirectory === await realpath(input.directory).catch(() => input.directory);
            if (!sameDirectory || existing.task !== input.task || JSON.stringify(existing.definition) !== JSON.stringify(input.definition)) throw new Error('Run ID already belongs to a different request.');
            return this.get(input.id);
        }
        if (this.closed) throw new Error('Coordinator is shutting down');
        const starting = this.starting.get(input.id);
        if (starting) {
            if (starting.request !== JSON.stringify(input)) throw new Error('Run ID already belongs to a different request.');
            return starting.promise;
        }
        if ([...this.runs.values()].filter(r => !terminal(r)).length + this.starting.size >= 3) throw new Error('Finish or cancel an existing run before starting another (maximum three).');
        const pending = this.create(input); this.starting.set(input.id, { request: JSON.stringify(input), promise: pending });
        try { return await pending; } finally { this.starting.delete(input.id); }
    }
    private async create(input: Start) {
        await this.runtime.validate(workflowSlots(input.definition));
        if (this.closed) throw new Error('Coordinator is shutting down');
        const workspace = await this.runtime.prepare(input);
        if (this.closed) throw new Error('Coordinator stopped during workspace preparation. No agents were started; the workspace is retained.');
        // This check and insertion below are synchronous, so simultaneous starts
        // cannot both claim a direct folder. Paused runs retain their claim;
        // cancelled runs retain it until their active process has stopped.
        const direct = workspace.directory === workspace.sourceDirectory;
        for (const existing of this.runs.values()) {
            if (terminal(existing) && !this.active.has(existing.id)) continue;
            if ((direct || existing.directory === existing.sourceDirectory) && overlappingDirectories(workspace.directory, existing.directory)) {
                throw new Error('Another workflow is using this project folder or an overlapping folder. Finish or cancel that run before starting here.');
            }
        }
        const now = Date.now();
        const run = WorkflowRunSchema.parse({ id: input.id, revision: 0, definition: input.definition, machineId: this.machineId, task: input.task, requestedDirectory: input.directory, ...workspace,
            ...(input.definition.steps ? { stepIndex: 0, stepAttempt: 1, completedSteps: [], stepRounds: {} } : {}),
            status: 'running', stage: 'propose', planningRound: 1, reviewRound: 1, planVersion: 1, plan: '', artifactVersion: '', reason: '',
            historyVersion: 1, tasks: [], checks: [], events: [], notes: [], approvedPlanVersion: null, createdAt: now, updatedAt: now });
        this.persist(run, `${direct ? 'Run created in the selected project folder.' : 'Run created in an isolated worktree.'} All required participants must approve.`);
        this.runs.set(run.id, run); this.kick(run); return this.get(run.id);
    }
    async action(raw: unknown) {
        this.readable();
        const a = WorkflowActionSchema.parse(raw), run = this.runs.get(a.id);
        if (!run) throw new Error('Workflow run not found');
        if (run.revision !== a.expectedRevision) throw new Error('This run changed. Refresh before applying your decision.');
        if (terminal(run)) throw new Error('This run has finished. Start a new run to change it.');
        if (a.action === 'pause' || a.action === 'cancel') {
            run.status = a.action === 'pause' ? 'paused' : 'cancelled'; run.reason = a.action === 'pause' ? 'Paused by you.' : this.active.has(run.id) ? cancellationPending : cancellationComplete;
            this.persist(run, run.reason); this.active.get(run.id)?.abort(); return this.get(run.id);
        }
        if (run.status === 'running' || this.active.has(run.id)) throw new Error('Wait for the current step to stop before changing the run.');
        if (run.notes.length >= 30 && a.note) throw new Error('Clarification limit reached. Start a new run with the refined task.');
        if (a.action === 'change_model') {
            this.assertResumeBudget(run);
            const slot = workflowRecoverableExecutor(run);
            if (!slot || !a.model) throw new Error('Only an interrupted executor without completed contributions can switch model. Use participant replacement to replan other changes.');
            if (run.approvedPlanVersion !== run.planVersion || !this.planApproved(run)) throw new Error('Current plan approvals are missing. Request a revised plan.');
            const agent = { ...slot.agent, revision: slot.agent.revision + 1, model: a.model, modelLabel: a.model, effort: a.effort ?? null };
            if (agent.model === slot.agent.model && agent.effort === slot.agent.effort) throw new Error('Choose a different model or resume with the current model.');
            const definition = structuredClone(run.definition);
            for (const match of workflowSlots(definition).filter(item => item.agent.id === agent.id)) match.agent = agent;
            if (definition.steps) Object.assign(definition, workflowProjection(definition.steps));
            const validated = WorkflowDefinitionSchema.parse(definition);
            await this.runtime.validate([{ ...slot, agent }]);
            // Another device may act while model discovery is in progress.
            if (run.revision !== a.expectedRevision || this.active.has(run.id) || this.closed) throw new Error('This run changed. Refresh before applying your decision.');
            for (const task of run.tasks.filter(task => task.agentId === agent.id)) {
                task.provider ??= slot.agent.provider; task.model ??= slot.agent.model;
                if (task.effort === undefined) task.effort = slot.agent.effort;
            }
            run.definition = validated;
            if (a.note) run.notes.push(a.note);
            run.status = 'running'; run.reason = '';
            this.persist(run, `${slot.agent.name}: switched model from ${slot.agent.model} to ${agent.model}. Resuming execution with plan v${run.planVersion} and completed approvals retained.${a.note ? ` — ${a.note}` : ''}`);
            this.kick(run); return this.get(run.id);
        }
        if (run.definition.steps) return this.stepAction(run, a);
        if (a.action === 'approve_plan') {
            if (run.stage !== 'plan_vote' || !this.planApproved(run)) throw new Error('Every planner must approve the current plan first.');
            run.approvedPlanVersion = run.planVersion; run.stage = 'execute';
        } else if (a.action === 'revise_plan' || a.action === 'replace_agent') {
            if (!a.note) throw new Error('Explain the change before replanning.');
            if (a.action === 'replace_agent') {
                if (!a.agentId || !a.replacement) throw new Error('Choose the participant and replacement.');
                const definition = structuredClone(run.definition);
                const slots = [...definition.planners, definition.executor, ...definition.reviewers];
                const slot = slots.find(s => s.agent.id === a.agentId); if (!slot) throw new Error('Participant not found');
                if (slots.some(s => s !== slot && s.agent.id === a.replacement!.id)) throw new Error('Replacement already participates in this workflow.');
                if (slot === definition.executor && a.replacement.permissionMode === 'read-only') throw new Error('Executor requires workspace edits.');
                slot.agent = a.replacement;
                run.definition = WorkflowDefinitionSchema.parse(definition);
            }
            run.planningRound = 1; run.planVersion++; run.plan = ''; run.stage = 'propose'; run.approvedPlanVersion = null; run.reviewRound = 1; run.checks = [];
        } else if (a.action === 'retry_review') {
            if (run.approvedPlanVersion !== run.planVersion || !this.planApproved(run) || !run.tasks.some(t => t.stage === 'execute' && t.status === 'done' && t.version === `plan:${run.planVersion}`)) throw new Error('An approved plan and completed execution are required before review.');
            if (run.reviewRound >= run.definition.reviewRounds) throw new Error('Review round limit reached. Start a new run or request a revised plan.');
            if (!a.note) throw new Error('Explain what was corrected before requesting another review.');
            run.reviewRound++; run.stage = 'verify'; run.checks = [];
        } else if (a.action === 'resume') {
            this.assertResumeBudget(run);
            if (run.stage === 'execute' && run.planningRound >= run.definition.planningRounds && this.current(run, run.definition.executor)?.result?.decision === 'replan') {
                throw new Error('Planning round limit reached. Request a revised plan.');
            }
            if (!a.note && run.status === 'needs_input') throw new Error('Add a response or confirm that interrupted work was inspected.');
            if (run.status === 'needs_input' && run.stage === 'plan_vote' && !this.planApproved(run)) {
                if (run.planningRound >= run.definition.planningRounds) throw new Error('Planning round limit reached. Request a revised plan.');
                run.planVersion++; run.planningRound++; run.stage = 'consolidate';
            } else if (run.status === 'needs_input' && run.stage === 'review') {
                if (run.reviewRound >= run.definition.reviewRounds) throw new Error('Review round limit reached. Request a revised plan.');
                run.reviewRound++; run.stage = 'verify';
            }
        }
        if (a.note) run.notes.push(a.note);
        run.status = 'running'; run.reason = ''; this.persist(run, `User action: ${a.action}${a.note ? ` — ${a.note}` : ''}`);
        this.kick(run); return this.get(run.id);
    }
    startStatus(id: string) { this.readable(); return this.runs.has(id) ? { state: 'created', id } : this.starting.has(id) ? { state: 'starting' } : { state: 'absent' }; }
    private current(run: WorkflowRun, slot: WorkflowSlot, stage = run.stage) {
        return [...run.tasks].reverse().find(t => (!run.definition.steps || t.stepId === run.definition.steps[run.stepIndex ?? 0]?.id && t.attempt === run.stepAttempt) && t.stage === stage && t.agentId === slot.agent.id && t.round === (stage === 'review' || stage === 'execute' ? run.reviewRound : run.planningRound) && t.version === (stage === 'review' ? run.artifactVersion : `plan:${run.planVersion}`) && t.status === 'done' && !(t.result?.decision !== 'approve' && (t.clarifications ?? 0) < run.notes.length));
    }
    private planApproved(run: WorkflowRun) {
        if (run.definition.steps) {
            const plan = run.definition.steps.slice(0, (run.stepIndex ?? 0) + 1).reverse().find(s => s.kind === 'plan');
            return !!plan && plan.agents.every(s => {
                const vote = [...run.tasks].reverse().find(t => t.stepId === plan.id && t.stage === 'plan_vote' && t.agentId === s.agent.id && t.version === `plan:${run.planVersion}` && t.status === 'done');
                return vote?.result?.decision === 'approve' && !vote.result.findings.some(f => f.blocking);
            });
        }
        return run.definition.planners.every(s => this.current(run, s, 'plan_vote')?.result?.decision === 'approve' && !this.current(run, s, 'plan_vote')?.result?.findings.some(f => f.blocking)); }
    private block(run: WorkflowRun, reason: string) { if (run.status !== 'running') return; run.status = 'needs_input'; run.reason = reason; this.persist(run, reason); }
    private assertResumeBudget(run: WorkflowRun) {
        // Provider diagnostics and participant summaries are free text (for example,
        // an OS "exec argument limit"). Only actual workflow limits block recovery.
        if (run.reason === agentTurnLimit && run.tasks.length >= run.definition.maxTurns) throw new Error(agentTurnLimit);
        // Context size is checked before creating a task, so it has no task counter.
        // Keep the exact persisted coordinator reason compatible with existing runs.
        if (run.reason === workflowContextLimit) throw new Error(workflowContextLimit);
    }
    private kick(run: WorkflowRun) {
        if (this.closed || this.active.has(run.id) || run.status !== 'running') return;
        const abort = new AbortController(); this.active.set(run.id, abort);
        const operation = this.drive(run, abort.signal).catch(e => {
            if (!this.loadError && run.status === 'running') {
                try { this.block(run, e instanceof Error ? e.message : 'Workflow step failed.'); } catch { /* Persistence failure already disabled workflows and aborted active work. */ }
            }
        })
            .finally(() => {
                this.active.delete(run.id); this.operations.delete(operation);
                if (!this.settled && !this.loadError && run.status === 'cancelled' && run.reason === cancellationPending) {
                    run.reason = cancellationComplete;
                    try { this.persist(run, run.reason); } catch { /* Persistence failure already disabled the coordinator. */ }
                }
            });
        this.operations.add(operation);
    }
    private async perform(run: WorkflowRun, slot: WorkflowSlot, signal: AbortSignal) {
        if (signal.aborted || run.status !== 'running') throw new Error('Workflow is no longer running');
        const done = this.current(run, slot); if (done?.result) return done.result;
        if (run.tasks.length >= run.definition.maxTurns) throw new Error(agentTurnLimit);
        const inputs = this.inputs(run);
        const prompt = this.prompt(run, slot, inputs);
        if (Buffer.byteLength(prompt) > 400000) throw new Error(workflowContextLimit);
        const task: WorkflowTask = { ...(run.definition.steps ? { stepId: run.definition.steps[run.stepIndex ?? 0].id, attempt: run.stepAttempt } : {}), id: randomUUID(), stage: run.stage, round: run.stage === 'execute' || run.stage === 'review' ? run.reviewRound : run.planningRound,
            agentId: slot.agent.id, agentName: slot.agent.name, assignment: slot.assignment, version: run.stage === 'review' ? run.artifactVersion : `plan:${run.planVersion}`,
            status: 'running', startedAt: Date.now(), clarifications: run.notes.length, inputs,
            participants: (run.definition.steps?.[run.stepIndex ?? 0]?.agents ?? (run.stage === 'review' ? run.definition.reviewers : run.stage === 'execute' ? [run.definition.executor] : run.definition.planners)).map(s => ({ id: s.agent.id, name: s.agent.name })), prompt };
        run.tasks.push(task); this.persist(run, `${slot.agent.name}: ${run.stage} started.`);
        try {
            const result = await this.runtime.turn(run, task, slot, signal, () => this.persist(run));
            if (signal.aborted) throw new Error('Step interrupted. Inspect its work before resuming.');
            if (result.findingResponses) result.findingResponses = validWorkflowResponses(run.tasks, task, result);
            task.result = result; task.status = 'done'; task.completedAt = Date.now(); this.persist(run, `${slot.agent.name}: ${result.decision} — ${result.summary}`); return result;
        } catch (e) { task.status = 'interrupted'; task.completedAt = Date.now(); task.error = e instanceof Error ? e.message : 'Step interrupted'; this.persist(run); throw e; }
    }
    private inputs(run: WorkflowRun): NonNullable<WorkflowTask['inputs']> {
        if (run.stage === 'propose') return [];
        const step = run.definition.steps?.[run.stepIndex ?? 0];
        const completed = run.tasks.filter(t => t.status === 'done');
        const local = completed.filter(t => !step || t.stepId === step.id && t.attempt === run.stepAttempt);
        const inputs: NonNullable<WorkflowTask['inputs']> = [];
        const add = (tasks: WorkflowTask[], content: NonNullable<WorkflowTask['inputs']>[number]['content']) => {
            for (const task of tasks) if (!inputs.some(i => i.taskId === task.id)) inputs.push({ taskId: task.id, content });
        };
        if (run.stage === 'consolidate') add(local.filter(t => t.stage === 'propose' || t.stage === 'plan_vote' && t.round < run.planningRound), 'result');
        if (run.stage === 'plan_vote') add(local.filter(t => t.stage === 'plan_vote' && t.round < run.planningRound || ['propose', 'consolidate'].includes(t.stage) && !!t.result?.findings.some(f => f.blocking)), 'findings');
        if (run.stage === 'execute') add(completed.filter(t => t.stage === 'review' && t.round === run.reviewRound - 1), 'result');
        if (run.stage === 'review') {
            add(local.filter(t => t.stage === 'review' && t.round < run.reviewRound), 'findings');
            add(completed.filter(t => t.stage === 'execute').slice(-1), 'result');
        }
        const plan = completed.filter(t => t.stage === 'consolidate' && t.version === `plan:${run.planVersion}`).slice(-1);
        add(plan, 'plan');
        if (step) add(completed.filter(t => t.stepId !== step.id).slice(-16), 'summary');
        return inputs;
    }
    private prompt(run: WorkflowRun, slot: WorkflowSlot, inputs: NonNullable<WorkflowTask['inputs']>) {
        const stage = run.stage;
        const step = run.definition.steps?.[run.stepIndex ?? 0];
        const interrupted = run.tasks.filter(task => task.status === 'interrupted' && task.stage === stage
            && task.version === `plan:${run.planVersion}` && (!step || task.stepId === step.id && task.attempt === run.stepAttempt)).slice(-3);
        const recovery = interrupted.length ? `\nRECOVERY: Earlier attempts of this step were interrupted. Inspect the existing files and partial edits before continuing; preserve completed work and repair incomplete changes. The approved plan still applies.\n${JSON.stringify(interrupted.map(task => ({ agent: task.agentName, model: task.model, sessionId: task.sessionId, threadId: task.threadId, error: task.error })))}` : '';
        const shared = inputs.map(input => {
            const task = run.tasks.find(t => t.id === input.taskId)!;
            const findings = task.result?.findings.map((finding, index) => ({ id: workflowFindingId(task, index), ...finding }));
            return { taskId: task.id, agent: task.agentName, version: task.version, content: input.content,
                ...(input.content === 'plan' ? { document: task.result?.document }
                    : input.content === 'findings' ? { findings }
                    : input.content === 'summary' ? { summary: task.result?.summary, findings }
                    : { result: { ...task.result, findings } }) };
        });
        const instruction = {
            propose: 'Independently propose an approach. Do not seek other participants\' proposals. Put your proposal in document.',
            consolidate: 'Consolidate the proposals and objections into ONE implementable plan. Put the complete plan in document. Address every unresolved objection. You cannot override votes.',
            plan_vote: 'Review the exact plan version below. Explicitly approve it or request specific changes. A blocking finding means changes. Use information for missing user input.',
            execute: `Implement the approved plan in ${run.directory === run.sourceDirectory ? 'the selected project folder. Preserve existing work; your edits and completion checks operate directly in this folder' : 'this isolated worktree'}. Address every review finding with evidence. Run relevant checks. Approve means ready for independent review. Use replan if scope or the agreed approach must change.`,
            review: 'Independently inspect the exact workspace revision and completion evidence. Verify every acceptance criterion and earlier fixes. Do not edit files. Approve only with no unresolved blocking findings. Supply evidence and actionable correction for each finding.',
            verify: '',
        }[stage];
        return `You are ${slot.agent.name}. ${slot.agent.description}\n${slot.agent.instructions}\n${slot.agent.documents.map(d => `${d.name}:\n${d.content}`).join('\n')}\n\nWORKFLOW STEP: ${step ? `${(run.stepIndex ?? 0) + 1}. ${step.name} (${step.kind})` : stage}\nSTEP CRITERIA: ${step?.criteria || 'Follow this step’s assignment.'}\n${step ? 'Execute and assess only the current step’s scope. Later steps remain responsible for their assignments. Intermediate reviewers gate this step; final reviewers must also verify all workflow acceptance criteria and completion checks.' : ''}\nSTEP SEQUENCE: ${run.definition.steps?.map(s => s.name).join(' → ') ?? 'Plan → Execute → Review'}\nWORKFLOW ASSIGNMENT: ${slot.assignment}\nTASK: ${run.task}\nACCEPTANCE CRITERIA: ${run.definition.criteria}\nREQUIRED COMPLETION CHECKS: ${JSON.stringify(run.definition.checks)}\nSTEP CHECKS: ${JSON.stringify(step?.checks ?? [])}\nSTAGE: ${stage}\nROUND: ${stage === 'execute' || stage === 'review' ? run.reviewRound : run.planningRound}\n${instruction}\nPLAN VERSION: ${run.planVersion}\n${stage === 'propose' ? '' : run.plan}\nWORKSPACE REVISION: ${run.artifactVersion}\nUSER CLARIFICATIONS: ${JSON.stringify(run.notes)}\nCOMPLETION EVIDENCE: ${stage === 'execute' || stage === 'review' ? JSON.stringify(run.checks) : ''}\nSHARED INPUTS: ${JSON.stringify(shared)}${recovery}\nFor every blocking finding in SHARED INPUTS that you assess, include a findingResponses entry with its exact findingId and concrete evidence. Consolidation/execution may mark addressed; only the original assessor may mark verified during a later clean approval, or open if unresolved. Do not claim verification on behalf of another agent. An empty array is appropriate when no prior finding applies.\nDo not invoke subagents or external actions outside this assignment. Never merge, publish, deploy, or send messages to others. The controller handles advancement. Return only the required structured result. Explain conclusions and evidence, not private reasoning.`;
    }
    private async drive(run: WorkflowRun, signal: AbortSignal) {
        await this.runtime.validate(workflowSlots(run.definition));
        if (run.definition.steps) return this.driveSteps(run, signal);
        while (run.status === 'running' && !signal.aborted && !this.closed) {
            if (run.stage === 'propose') {
                for (const slot of run.definition.planners) { await this.perform(run, slot, signal); if (signal.aborted) return; }
                run.stage = 'consolidate';
            } else if (run.stage === 'consolidate') {
                const r = await this.perform(run, run.definition.planners[0], signal);
                if (r.decision === 'information' || !r.document.trim()) { this.block(run, r.summary); return; }
                run.plan = r.document; run.stage = 'plan_vote';
            } else if (run.stage === 'plan_vote') {
                const results = [];
                for (const slot of run.definition.planners) results.push(await this.perform(run, slot, signal));
                if (results.some(r => r.decision === 'information')) { this.block(run, 'Planners need information. Answer and request a revised plan.'); return; }
                if (!this.planApproved(run) || results.some(r => r.findings.some(f => f.blocking))) {
                    if (run.planningRound >= run.definition.planningRounds) { this.block(run, 'Planning round limit reached without consensus.'); return; }
                    run.planningRound++; run.planVersion++; run.stage = 'consolidate';
                } else if (run.definition.approvePlan && run.approvedPlanVersion !== run.planVersion) { this.block(run, 'Every planner approved. Your approval is required before execution.'); return; }
                else { run.approvedPlanVersion = run.planVersion; run.stage = 'execute'; }
            } else if (run.stage === 'execute') {
                const r = await this.perform(run, run.definition.executor, signal);
                if (r.decision === 'replan') {
                    if (run.planningRound >= run.definition.planningRounds) { this.block(run, 'Planning round limit reached after execution requested a plan change.'); return; }
                    if (run.notes.length >= 30) throw new Error('Clarification limit reached. Start a new run with the refined task.');
                    run.notes.push(`Executor requested a plan change: ${r.summary}`); run.planningRound++; run.planVersion++; run.stage = 'consolidate'; run.approvedPlanVersion = null;
                } else if (r.decision !== 'approve') { this.block(run, r.summary); return; }
                else { run.stage = 'verify'; run.checks = []; }
            } else if (run.stage === 'verify') {
                const version = await this.runtime.version(run.directory); run.checks = [];
                for (const check of run.definition.checks) {
                    if (signal.aborted) return;
                    const r = await this.runtime.check(run.directory, check.command, signal); run.checks.push({ name: check.name, ...r, version }); this.persist(run);
                }
                if (version !== await this.runtime.version(run.directory)) { this.block(run, 'Completion checks changed workspace files. Inspect the changes, then request a fresh review.'); return; }
                run.artifactVersion = version; run.stage = 'review';
            } else if (run.stage === 'review') {
                if (await this.runtime.version(run.directory) !== run.artifactVersion) { this.block(run, 'Workspace changed after verification. Request a fresh review.'); return; }
                const results = [];
                for (const slot of run.definition.reviewers) results.push(await this.perform(run, slot, signal));
                if (await this.runtime.version(run.directory) !== run.artifactVersion) { this.block(run, 'Workspace changed during review. Approvals are no longer current.'); return; }
                if (results.some(r => r.decision === 'information' || r.decision === 'replan')) { this.block(run, 'Reviewers need clarification or a revised plan. Inspect their findings.'); return; }
                if (signal.aborted || run.status !== 'running') return;
                if (run.approvedPlanVersion !== run.planVersion || !this.planApproved(run)) { this.block(run, 'Current plan approvals are missing. Request a revised plan.'); return; }
                if (results.every(r => r.decision === 'approve' && !r.findings.some(f => f.blocking)) && run.checks.length === run.definition.checks.length && run.checks.every(c => c.exitCode === 0 && c.version === run.artifactVersion)) {
                    run.status = 'complete'; this.persist(run, 'Completed: every required reviewer approved this revision and all completion checks passed.'); return;
                }
                if (run.reviewRound >= run.definition.reviewRounds) { this.block(run, 'Review round limit reached with unresolved findings or failed checks.'); return; }
                run.reviewRound++; run.stage = 'execute';
            }
            if (run.status === 'running') this.persist(run, `Advancing to ${run.stage}.`);
        }
    }
    /** Move only after persisting the previous gate; attempts prevent reusing another step's work. */
    private enterStep(run: WorkflowRun, index: number) {
        const step = run.definition.steps![index];
        run.stepIndex = index; run.stepAttempt = (run.stepAttempt ?? 0) + 1;
        run.stage = step.kind === 'plan' ? 'propose' : step.kind === 'execute' ? 'execute' : 'verify';
        run.reviewRound = run.stepRounds?.[step.id] ?? 1;
        if (step.kind === 'plan') { run.planningRound = 1; run.planVersion++; run.approvedPlanVersion = null; }
        if (step.kind === 'review') run.checks = [];
    }
    private advanceStep(run: WorkflowRun) {
        const index = run.stepIndex ?? 0, steps = run.definition.steps!;
        run.completedSteps = [...new Set([...(run.completedSteps ?? []), steps[index].id])];
        if (index === steps.length - 1) { run.status = 'complete'; this.persist(run, 'Completed: all configured steps passed; final reviewers approved this revision and completion checks passed.'); }
        else this.enterStep(run, index + 1);
    }
    private stepAction(run: WorkflowRun, a: ReturnType<typeof WorkflowActionSchema.parse>) {
        const steps = run.definition.steps!, index = run.stepIndex ?? 0;
        if (a.action === 'approve_plan') {
            if (run.stage !== 'plan_vote' || !this.planApproved(run)) throw new Error('Every planner must approve the current plan first.');
            run.approvedPlanVersion = run.planVersion; this.advanceStep(run);
        } else if (a.action === 'revise_plan' || a.action === 'replace_agent') {
            if (!a.note) throw new Error('Explain the change before replanning.');
            if (a.action === 'replace_agent') {
                if (!a.agentId || !a.replacement) throw new Error('Choose the participant and replacement.');
                const definition = structuredClone(run.definition);
                const matches = workflowSlots(definition).filter(s => s.agent.id === a.agentId);
                if (!matches.length) throw new Error('Participant not found');
                for (const slot of matches) slot.agent = a.replacement;
                Object.assign(definition, workflowProjection(definition.steps!));
                run.definition = WorkflowDefinitionSchema.parse(definition);
            }
            run.completedSteps = []; run.stepRounds = {}; run.plan = ''; run.checks = []; this.enterStep(run, 0);
        } else if (a.action === 'retry_review') {
            if (steps[index].kind !== 'review' || run.approvedPlanVersion !== run.planVersion || !this.planApproved(run)) throw new Error('An approved plan and a reached review step are required.');
            if (!a.note) throw new Error('Explain what was corrected before requesting another review.');
            if (run.reviewRound >= run.definition.reviewRounds) throw new Error('Review round limit reached. Request a revised plan.');
            run.stepRounds = { ...run.stepRounds, [steps[index].id]: run.reviewRound + 1 }; this.enterStep(run, index);
        } else if (a.action === 'resume') {
            this.assertResumeBudget(run);
            if (!a.note && run.status === 'needs_input') throw new Error('Add a response or confirm that interrupted work was inspected.');
            if (run.status === 'needs_input' && run.stage === 'plan_vote' && !this.planApproved(run)) {
                if (run.planningRound >= run.definition.planningRounds) throw new Error('Planning round limit reached. Request a revised plan.');
                run.planVersion++; run.planningRound++; run.stage = 'consolidate';
            } else if (run.status === 'needs_input' && (run.stage === 'review' || run.stage === 'verify')) {
                if (run.reviewRound >= run.definition.reviewRounds) throw new Error('Review round limit reached. Request a revised plan.');
                run.stepRounds = { ...run.stepRounds, [steps[index].id]: run.reviewRound + 1 }; this.enterStep(run, index);
            }
        }
        if (a.note) run.notes.push(a.note);
        run.status = 'running'; run.reason = ''; this.persist(run, `User action: ${a.action}${a.note ? ` — ${a.note}` : ''}`);
        this.kick(run); return this.get(run.id);
    }
    private async driveSteps(run: WorkflowRun, signal: AbortSignal) {
        const live = () => run.status === 'running' && !signal.aborted && !this.closed;
        while (live()) {
            const index = run.stepIndex ?? 0, step = run.definition.steps![index];
            if (!step) throw new Error('Saved workflow step is missing.');
            if (run.stage === 'propose') {
                for (const slot of step.agents) { await this.perform(run, slot, signal); if (!live()) return; }
                run.stage = 'consolidate';
            } else if (run.stage === 'consolidate') {
                const result = await this.perform(run, step.agents[0], signal); if (!live()) return;
                if (result.decision === 'information' || !result.document.trim()) { this.block(run, result.summary); return; }
                run.plan = result.document; run.stage = 'plan_vote';
            } else if (run.stage === 'plan_vote') {
                const results = [];
                for (const slot of step.agents) { results.push(await this.perform(run, slot, signal)); if (!live()) return; }
                if (results.some(r => r.decision === 'information')) { this.block(run, 'Planners need information. Answer and request a revised plan.'); return; }
                if (!this.planApproved(run)) {
                    if (run.planningRound >= run.definition.planningRounds) { this.block(run, 'Planning round limit reached without consensus.'); return; }
                    run.planningRound++; run.planVersion++; run.stage = 'consolidate';
                } else if (run.definition.approvePlan && run.approvedPlanVersion !== run.planVersion) { this.block(run, `All planners approved ${step.name}. Your approval is required to continue.`); return; }
                else { run.approvedPlanVersion = run.planVersion; this.advanceStep(run); }
            } else if (run.stage === 'execute') {
                if (run.approvedPlanVersion !== run.planVersion || !this.planApproved(run)) throw new Error('Current plan approvals are missing. Request a revised plan.');
                const result = await this.perform(run, step.agents[0], signal); if (!live()) return;
                if (result.decision !== 'approve' || result.findings.some(f => f.blocking)) { this.block(run, `${result.decision === 'replan' ? 'Request a revised plan. ' : ''}${result.summary}`); return; }
                this.advanceStep(run);
            } else if (run.stage === 'verify') {
                const checks = [...step.checks, ...(index === run.definition.steps!.length - 1 ? run.definition.checks : [])];
                const version = await this.runtime.version(run.directory); if (!live()) return; run.checks = [];
                for (const check of checks) {
                    const result = await this.runtime.check(run.directory, check.command, signal); if (!live()) return;
                    run.checks.push({ name: check.name, ...result, version }); this.persist(run);
                }
                if (version !== await this.runtime.version(run.directory)) { this.block(run, 'Completion checks changed workspace files. Inspect the changes, then request a fresh review.'); return; }
                if (!live()) return;
                run.artifactVersion = version; run.stage = 'review';
            } else if (run.stage === 'review') {
                if (await this.runtime.version(run.directory) !== run.artifactVersion) { this.block(run, 'Workspace changed after verification. Request a fresh review.'); return; }
                const results = [];
                for (const slot of step.agents) { results.push(await this.perform(run, slot, signal)); if (!live()) return; }
                if (await this.runtime.version(run.directory) !== run.artifactVersion) { this.block(run, 'Workspace changed during review. Approvals are no longer current.'); return; }
                if (!live()) return;
                if (!this.planApproved(run) || run.approvedPlanVersion !== run.planVersion) throw new Error('Current plan approvals are missing. Request a revised plan.');
                if (results.some(r => r.decision === 'information' || r.decision === 'replan')) { this.block(run, 'Reviewers need clarification or a revised plan. Inspect their findings.'); return; }
                const count = step.checks.length + (index === run.definition.steps!.length - 1 ? run.definition.checks.length : 0);
                if (results.every(r => r.decision === 'approve' && !r.findings.some(f => f.blocking)) && run.checks.length === count && run.checks.every(c => c.exitCode === 0 && c.version === run.artifactVersion)) this.advanceStep(run);
                else {
                    if (run.reviewRound >= run.definition.reviewRounds) { this.block(run, 'Review round limit reached with unresolved findings or failed checks.'); return; }
                    run.stepRounds = { ...run.stepRounds, [step.id]: run.reviewRound + 1 };
                    const executor = run.definition.steps!.map((s, i) => s.kind === 'execute' && i < index ? i : -1).reduce((a, b) => Math.max(a, b), -1);
                    if (executor < 0) throw new Error('No preceding execution step can address these findings.');
                    const retained = new Set(run.definition.steps!.slice(0, executor).map(s => s.id));
                    run.completedSteps = run.completedSteps?.filter(id => retained.has(id));
                    this.enterStep(run, executor);
                }
            }
            if (live()) this.persist(run, `Step ${(run.stepIndex ?? 0) + 1}: ${run.definition.steps![run.stepIndex ?? 0].name} — ${run.stage}.`);
        }
    }
    async shutdown() {
        this.closed = true;
        for (const [id, abort] of this.active) {
            const run = this.runs.get(id)!;
            if (run.status === 'running') {
                run.status = 'paused'; run.reason = 'Coordinator stopped. Inspect any interrupted work before resuming.';
                try { this.persist(run, run.reason); } catch { /* State failure already aborts every active step. */ }
            }
            abort.abort();
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
            Promise.allSettled([...this.operations, ...[...this.starting.values()].map(s => s.promise)]),
            new Promise<void>(resolve => { timer = setTimeout(resolve, 15000); }),
        ]);
        clearTimeout(timer);
        // Even a non-cooperative provider cannot write over the replacement coordinator's state.
        this.settled = true; this.loadError = true;
    }
}
