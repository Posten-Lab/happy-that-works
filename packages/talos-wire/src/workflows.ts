import { z } from 'zod';

const text = z.string().trim().min(1).max(24000);
export const WorkflowAgentSchema = z.object({
    id: z.string().min(1).max(100), revision: z.number().int().positive(), name: z.string().min(1).max(60),
    description: z.string().max(300), provider: z.literal('codex'), model: z.string().min(1).max(200),
    effort: z.string().max(30).nullable(), permissionMode: z.enum(['default', 'read-only']),
    instructions: text, documents: z.array(z.object({ name: z.string().max(120), content: z.string().max(16000) })).max(5),
});
export const WorkflowSlotSchema = z.object({ agent: WorkflowAgentSchema, assignment: text });
export const WorkflowDefinitionSchema = z.object({
    id: z.string().uuid(), revision: z.number().int().positive(), name: z.string().trim().min(1).max(80),
    description: z.string().max(1000), planners: z.array(WorkflowSlotSchema).min(2).max(4),
    executor: WorkflowSlotSchema, reviewers: z.array(WorkflowSlotSchema).min(2).max(4),
    criteria: text,
    checks: z.array(z.object({ name: z.string().trim().min(1).max(100), command: z.string().trim().min(1).max(2000) })).min(1).max(8),
    planningRounds: z.number().int().min(1).max(5), reviewRounds: z.number().int().min(1).max(5),
    turnMinutes: z.number().int().min(1).max(30), maxTurns: z.number().int().min(8).max(100),
    approvePlan: z.boolean(), updatedAt: z.number(),
}).superRefine((d, ctx) => {
    if (new TextEncoder().encode(JSON.stringify(d)).length > 64000) ctx.addIssue({ code: 'custom', message: 'Workflow definition exceeds 64 KB. Shorten instructions or documents.' });
    const ids = [...d.planners, d.executor, ...d.reviewers].map(s => s.agent.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Each workflow participant must be a different saved agent.' });
    if (d.executor.agent.permissionMode === 'read-only') ctx.addIssue({ code: 'custom', message: 'The executor must allow workspace edits.' });
});
export const WorkflowLibrarySchema = z.array(WorkflowDefinitionSchema).max(20).refine(x => JSON.stringify(x).length < 128000, 'Workflow library is too large.');
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;
export type WorkflowSlot = z.infer<typeof WorkflowSlotSchema>;
export type WorkflowAgent = z.infer<typeof WorkflowAgentSchema>;
export const WorkflowStageSchema = z.enum(['propose', 'consolidate', 'plan_vote', 'execute', 'review', 'verify']);
export type WorkflowStage = z.infer<typeof WorkflowStageSchema>;
export const WorkflowDecisionSchema = z.object({
    decision: z.enum(['approve', 'changes', 'information', 'replan']), summary: text,
    document: z.string().max(24000),
    findings: z.array(z.object({ title: z.string().min(1).max(300), evidence: text, correction: text, blocking: z.boolean() })).max(20),
});
export type WorkflowDecision = z.infer<typeof WorkflowDecisionSchema>;
export const WorkflowTaskSchema = z.object({
    id: z.string(), stage: WorkflowStageSchema, round: z.number(), agentId: z.string(), agentName: z.string(),
    clarifications: z.number().int().optional(),
    assignment: z.string(), version: z.string(), status: z.enum(['running', 'done', 'interrupted']),
    startedAt: z.number(), completedAt: z.number().optional(), sessionId: z.string().optional(),
    threadId: z.string().optional(), prompt: z.string(), result: WorkflowDecisionSchema.optional(), error: z.string().optional(),
});
export const WorkflowRunSchema = z.object({
    id: z.string().uuid(), revision: z.number().int(), definition: WorkflowDefinitionSchema, machineId: z.string(),
    task: text, requestedDirectory: z.string().optional(), sourceDirectory: z.string(), directory: z.string(), branch: z.string(), baseCommit: z.string(),
    status: z.enum(['running', 'paused', 'needs_input', 'complete', 'cancelled']), stage: WorkflowStageSchema,
    planningRound: z.number().int(), reviewRound: z.number().int(), planVersion: z.number().int(), plan: z.string(),
    artifactVersion: z.string(), reason: z.string(), tasks: z.array(WorkflowTaskSchema).max(200),
    checks: z.array(z.object({ name: z.string(), exitCode: z.number().nullable(), output: z.string(), version: z.string() })),
    events: z.array(z.object({ at: z.number(), text: z.string() })).max(500),
    notes: z.array(z.string()).max(30), approvedPlanVersion: z.number().nullable(),
    createdAt: z.number(), updatedAt: z.number(),
});
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;
export type WorkflowTask = z.infer<typeof WorkflowTaskSchema>;
export const WorkflowStartSchema = z.object({ id: z.string().uuid(), definition: WorkflowDefinitionSchema, task: text, directory: z.string().min(1).max(4000) });
export const WorkflowActionSchema = z.object({
    id: z.string().uuid(), expectedRevision: z.number().int(), action: z.enum(['pause', 'resume', 'cancel', 'approve_plan', 'revise_plan', 'retry_review', 'replace_agent']),
    note: z.string().trim().max(24000).default(''), agentId: z.string().optional(), replacement: WorkflowAgentSchema.optional(),
});
export function workflowEnabled(s: { experiments?: boolean; expWorkflows?: boolean }) { return s.experiments === true && s.expWorkflows === true; }
export const workflowStageLabel: Record<WorkflowStage, string> = { propose: 'Independent proposals', consolidate: 'Consolidating plan', plan_vote: 'Planning consensus', execute: 'Executing', review: 'Independent review', verify: 'Completion checks' };
