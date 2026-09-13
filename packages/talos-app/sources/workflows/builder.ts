import { randomUUID } from 'expo-crypto';
import { workflowProjection, workflowSlots, type WorkflowDefinition, type WorkflowStep, type WorkflowAgent } from '@ahmadposten/talos-wire';
import type { AgentDefinition } from '@/agents/agentDefinition';

export const stepLabels = { plan: 'Planning', execute: 'Execution', review: 'Review' };
export function newWorkflowStep(kind: WorkflowStep['kind']): WorkflowStep {
    return { id: randomUUID(), name: stepLabels[kind], kind, agents: [], criteria: '', checks: [] };
}
/** Drafts may have empty slots; the wire schema is the save/start boundary. */
export function withSteps(draft: WorkflowDefinition, steps: WorkflowStep[]): WorkflowDefinition {
    return { ...draft, steps, ...workflowProjection(steps) } as WorkflowDefinition;
}
export function editableWorkflow(existing?: WorkflowDefinition): WorkflowDefinition {
    if (existing) return existing.steps ? structuredClone(existing) : withSteps(existing, [
        { ...newWorkflowStep('plan'), agents: existing.planners },
        { ...newWorkflowStep('execute'), agents: [existing.executor] },
        { ...newWorkflowStep('review'), agents: existing.reviewers },
    ]);
    return withSteps({ id: randomUUID(), revision: 1, name: '', description: '', criteria: '',
        checks: [{ name: 'Required verification', command: '' }], planningRounds: 3, reviewRounds: 3,
        turnMinutes: 10, maxTurns: 60, approvePlan: false, updatedAt: Date.now() } as WorkflowDefinition,
        [newWorkflowStep('plan'), { ...newWorkflowStep('execute'), name: 'Build' }, newWorkflowStep('review')]);
}
export function attachWorkflowAgent(draft: WorkflowDefinition, stepId: string, agent: WorkflowAgent, replacing?: number) {
    return withSteps(draft, draft.steps!.map(step => step.id !== stepId ? step : { ...step,
        agents: replacing === undefined ? [...step.agents, { agent, assignment: `Carry out the ${step.name} step and verify its criteria.` }]
            : step.agents.map((slot, i) => i === replacing ? { ...slot, agent } : slot) }));
}
export function builderAgent(name: string, kind: WorkflowStep['kind'], model: string, effort: string | null): AgentDefinition {
    return { id: randomUUID(), revision: 1, name, description: `${stepLabels[kind]} specialist`, provider: 'codex', model, effort,
        avatar: kind === 'plan' ? 'compass' : kind === 'execute' ? 'sparkles' : 'eye', specialties: [kind === 'execute' ? 'development' : kind === 'review' ? 'review' : 'design'],
        permissionMode: kind === 'execute' ? 'default' : 'read-only',
        instructions: kind === 'plan' ? 'Independently propose a practical plan. Challenge assumptions and missing requirements. Approve only an implementable, verifiable plan.' : kind === 'execute' ? 'Implement the approved plan and your step assignment. Preserve unrelated work. Verify changes and address reviewer findings with evidence.' : 'Independently inspect this step’s criteria and the actual result. Provide evidence and actionable corrections for findings. Do not edit files. Approve only when there are no blocking findings.',
        documents: [], updatedAt: Date.now() };
}
export function usedWorkflowAgents(draft: WorkflowDefinition) { return workflowSlots(draft); }
