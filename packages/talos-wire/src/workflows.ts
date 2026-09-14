import { z } from 'zod';

export const AGENT_DOCUMENT_MAX_CHARACTERS = 64000;
export const AgentDocumentSchema = z.object({
    name: z.string().min(1).max(120),
    content: z.string().max(AGENT_DOCUMENT_MAX_CHARACTERS, 'Each instruction file can contain up to 64,000 characters.'),
});

const text = z.string().trim().min(1).max(24000);
export const WorkflowAgentSchema = z.object({
    id: z.string().min(1).max(100), revision: z.number().int().positive(), name: z.string().min(1).max(60),
    description: z.string().max(300), provider: z.enum(['codex', 'claude', 'muse']), model: z.string().min(1).max(200), modelLabel: z.string().max(300).optional(),
    effort: z.string().max(30).nullable(), permissionMode: z.enum(['default', 'read-only', 'yolo']),
    instructions: text, documents: z.array(AgentDocumentSchema).max(5),
});
export const WorkflowSlotSchema = z.object({ agent: WorkflowAgentSchema, assignment: text });
export const WorkflowStepSchema = z.object({
    id: z.string().uuid(), name: z.string().trim().min(1).max(80),
    kind: z.enum(['plan', 'execute', 'review']), agents: z.array(WorkflowSlotSchema).min(1).max(3),
    criteria: z.string().trim().max(24000),
    checks: z.array(z.object({ name: z.string().trim().min(1).max(100), command: z.string().trim().min(1).max(2000) })).max(8),
});
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
/** Legacy summaries are derived, never independently editable in a staged workflow. */
export function workflowProjection(steps: WorkflowStep[]) {
    return { planners: steps.find(s => s.kind === 'plan')?.agents ?? [],
        executor: steps.find(s => s.kind === 'execute')?.agents[0],
        reviewers: [...steps].reverse().find(s => s.kind === 'review')?.agents ?? [] };
}
export const WorkflowDefinitionSchema = z.object({
    id: z.string().uuid(), revision: z.number().int().positive(), name: z.string().trim().min(1).max(80),
    description: z.string().max(1000), planners: z.array(WorkflowSlotSchema).min(1).max(4),
    executor: WorkflowSlotSchema, reviewers: z.array(WorkflowSlotSchema).min(1).max(4),
    steps: z.array(WorkflowStepSchema).min(3).max(8).optional(),
    criteria: text,
    checks: z.array(z.object({ name: z.string().trim().min(1).max(100), command: z.string().trim().min(1).max(2000) })).min(1).max(8),
    planningRounds: z.number().int().min(1).max(5), reviewRounds: z.number().int().min(1).max(5),
    turnMinutes: z.number().int().min(1).max(30), maxTurns: z.number().int().min(8).max(100),
    approvePlan: z.boolean(), updatedAt: z.number(),
}).superRefine((d, ctx) => {
    if (new TextEncoder().encode(JSON.stringify(d)).length > 64000) ctx.addIssue({ code: 'custom', message: 'Workflow definition exceeds 64 KB. Shorten instructions or documents.' });
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (d.steps) {
        if (d.steps[0].kind !== 'plan' || d.steps.at(-1)?.kind !== 'review' || !d.steps.some(s => s.kind === 'execute')) issue('Start with planning, include execution, and finish with review.');
        if (new Set(d.steps.map(s => s.id)).size !== d.steps.length) issue('Each step needs a unique ID.');
        const writers = new Set(d.steps.filter(s => s.kind === 'execute').flatMap(s => s.agents.map(a => a.agent.id)));
        const identities = new Map<string, string>();
        let executed = false;
        for (const step of d.steps) {
            if (step.kind === 'plan') executed = false;
            if (step.kind === 'execute') executed = true;
            if (step.kind === 'review' && !executed) issue('Place an execution step between planning and review.');
            if (step.kind === 'execute' && (step.agents.length !== 1 || step.agents[0].agent.permissionMode === 'read-only')) issue('Each execution step needs one agent that allows workspace edits.');
            if (step.kind !== 'review' && step.checks.length) issue('Attach step checks to a review step.');
            if (new Set(step.agents.map(s => s.agent.id)).size !== step.agents.length) issue('Choose distinct agents within a consensus step.');
            for (const slot of step.agents) {
                if (step.kind === 'review' && writers.has(slot.agent.id)) issue('Reviewers must be independent of every executor.');
                const snapshot = JSON.stringify(slot.agent);
                if (identities.has(slot.agent.id) && identities.get(slot.agent.id) !== snapshot) issue('A reused agent must have the same configuration in every step.');
                identities.set(slot.agent.id, snapshot);
            }
        }
        const projection = workflowProjection(d.steps);
        if (JSON.stringify([d.planners, d.executor, d.reviewers]) !== JSON.stringify([projection.planners, projection.executor, projection.reviewers])) issue('Workflow role summaries must match its steps.');
    } else {
        if (d.planners.length < 2 || d.reviewers.length < 2) issue('Legacy workflows require at least two planners and reviewers.');
        const ids = [...d.planners, d.executor, ...d.reviewers].map(s => s.agent.id);
        if (new Set(ids).size !== ids.length) issue('Each workflow participant must be a different saved agent.');
        if (d.executor.agent.permissionMode === 'read-only') issue('The executor must allow workspace edits.');
    }
});
export const WorkflowLibrarySchema = z.array(WorkflowDefinitionSchema).max(20).refine(x => JSON.stringify(x).length < 128000, 'Workflow library is too large.');
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;
export type WorkflowSlot = z.infer<typeof WorkflowSlotSchema>;
export function workflowSlots(d: WorkflowDefinition): WorkflowSlot[] { return d.steps?.flatMap(s => s.agents) ?? [...d.planners, d.executor, ...d.reviewers]; }
export type WorkflowAgent = z.infer<typeof WorkflowAgentSchema>;
export const WorkflowStageSchema = z.enum(['propose', 'consolidate', 'plan_vote', 'execute', 'review', 'verify']);
export type WorkflowStage = z.infer<typeof WorkflowStageSchema>;
export const WorkflowDecisionSchema = z.object({
    decision: z.enum(['approve', 'changes', 'information', 'replan']), summary: text,
    document: z.string().max(24000),
    findingResponses: z.array(z.object({ findingId: z.string().min(1).max(100), status: z.enum(['open', 'addressed', 'verified']), evidence: text })).max(40).optional(),
    findings: z.array(z.object({ title: z.string().min(1).max(300), evidence: text, correction: text, blocking: z.boolean() })).max(20),
});
export const WorkflowDecisionOutputSchema = WorkflowDecisionSchema.required({ findingResponses: true });
export type WorkflowDecision = z.infer<typeof WorkflowDecisionSchema>;
export const WorkflowTaskSchema = z.object({
    id: z.string(), stage: WorkflowStageSchema, round: z.number(), agentId: z.string(), agentName: z.string(),
    stepId: z.string().uuid().optional(), attempt: z.number().int().positive().optional(),
    clarifications: z.number().int().optional(),
    participants: z.array(z.object({ id: z.string(), name: z.string() })).max(4).optional(),
    // Exact source records included in this task's prompt. Absent on older runs.
    inputs: z.array(z.object({ taskId: z.string(), content: z.enum(['result', 'findings', 'summary', 'plan']) })).max(200).optional(),
    assignment: z.string(), version: z.string(), status: z.enum(['running', 'done', 'interrupted']),
    startedAt: z.number(), completedAt: z.number().optional(), sessionId: z.string().optional(),
    threadId: z.string().optional(), prompt: z.string(), result: WorkflowDecisionSchema.optional(), error: z.string().optional(),
    provider: WorkflowAgentSchema.shape.provider.optional(), model: z.string().optional(), effort: z.string().nullable().optional(),
});
export const WorkflowRunSchema = z.object({
    id: z.string().uuid(), revision: z.number().int(), definition: WorkflowDefinitionSchema, machineId: z.string(),
    historyVersion: z.literal(1).optional(),
    task: text, requestedDirectory: z.string().optional(), sourceDirectory: z.string(), directory: z.string(), branch: z.string(), baseCommit: z.string(),
    status: z.enum(['running', 'paused', 'needs_input', 'complete', 'cancelled']), stage: WorkflowStageSchema,
    stepIndex: z.number().int().nonnegative().optional(), stepAttempt: z.number().int().positive().optional(),
    stepRounds: z.record(z.string(), z.number().int().positive()).optional(),
    completedSteps: z.array(z.string().uuid()).max(8).optional(),
    planningRound: z.number().int(), reviewRound: z.number().int(), planVersion: z.number().int(), plan: z.string(),
    artifactVersion: z.string(), reason: z.string(), tasks: z.array(WorkflowTaskSchema).max(200),
    checks: z.array(z.object({ name: z.string(), exitCode: z.number().nullable(), output: z.string(), version: z.string() })),
    events: z.array(z.object({ at: z.number(), text: z.string() })).max(500),
    notes: z.array(z.string()).max(30), approvedPlanVersion: z.number().nullable(),
    createdAt: z.number(), updatedAt: z.number(),
}).superRefine((run, ctx) => {
    if (!run.definition.steps) return;
    const steps = run.definition.steps;
    const step = steps[run.stepIndex ?? -1];
    if (!step || !run.stepAttempt || !run.completedSteps || !run.stepRounds) {
        ctx.addIssue({ code: 'custom', message: 'Editable workflow recovery state is incomplete.' }); return;
    }
    const stages = step.kind === 'plan' ? ['propose', 'consolidate', 'plan_vote'] : step.kind === 'execute' ? ['execute'] : ['verify', 'review'];
    if (!stages.includes(run.stage) || run.completedSteps.some(id => !steps.some(s => s.id === id)) || run.tasks.some(t => !t.stepId || !t.attempt || !steps.some(s => s.id === t.stepId))) ctx.addIssue({ code: 'custom', message: 'Saved workflow stage does not match its definition.' });
});
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;
export type WorkflowTask = z.infer<typeof WorkflowTaskSchema>;
export const WorkflowStartSchema = z.object({ id: z.string().uuid(), definition: WorkflowDefinitionSchema, task: text, directory: z.string().min(1).max(4000) });
export const WorkflowActionSchema = z.object({
    id: z.string().uuid(), expectedRevision: z.number().int(), action: z.enum(['pause', 'resume', 'cancel', 'approve_plan', 'revise_plan', 'retry_review', 'replace_agent', 'change_model']),
    note: z.string().trim().max(24000).default(''), agentId: z.string().optional(), replacement: WorkflowAgentSchema.optional(),
    model: z.string().trim().min(1).max(200).optional(), effort: z.string().max(30).nullable().optional(),
});
/** A model-only retry cannot reinterpret a participant's completed contributions. */
export function workflowRecoverableExecutor(run: WorkflowRun): WorkflowSlot | undefined {
    if (!['needs_input', 'paused'].includes(run.status) || run.stage !== 'execute') return;
    const step = run.definition.steps?.[run.stepIndex ?? 0];
    const slot = step ? step.agents[0] : run.definition.executor;
    const tasks = run.tasks.filter(task => task.agentId === slot.agent.id);
    const latest = tasks.at(-1);
    if (!latest || latest.status !== 'interrupted' || latest.stage !== 'execute' || latest.version !== `plan:${run.planVersion}`
        || step && (latest.stepId !== step.id || latest.attempt !== run.stepAttempt)
        || tasks.some(task => task.status === 'done')) return;
    return slot;
}
export function workflowEnabled(s: { experiments?: boolean; expWorkflows?: boolean }) { return s.experiments === true && s.expWorkflows === true; }
export const workflowStageLabel: Record<WorkflowStage, string> = { propose: 'Independent proposals', consolidate: 'Consolidating plan', plan_vote: 'Planning consensus', execute: 'Executing', review: 'Independent review', verify: 'Completion checks' };

export function workflowNeedsProviders(definition: WorkflowDefinition): boolean {
    return workflowSlots(definition).some(slot => slot.agent.provider !== 'codex');
}
