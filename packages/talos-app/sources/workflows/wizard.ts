import { WorkflowDefinitionSchema, type WorkflowDefinition } from '@ahmadposten/talos-wire';
import type { AgentDefinition } from '@/agents/agentDefinition';

export const workflowWizardSteps = ['Basics', 'Team', 'Finish', 'Review'] as const;
export type WorkflowBuilderSection = 'basics' | 'team' | 'finish';

/** Validate only the page being left, so later empty fields never block an earlier step. */
export function workflowWizardProblem(draft: WorkflowDefinition, page: number): string | null {
    if (page === 0) {
        if (!draft.name.trim()) return 'Give your workflow a name before continuing.';
        if (draft.name.trim().length > 80) return 'Keep the workflow name to 80 characters or fewer.';
        if (draft.description.length > 1000) return 'Keep the description to 1,000 characters or fewer.';
        return null;
    }
    if (page === 1) {
        const steps = draft.steps ?? [];
        if (steps.length < 3) return 'Add at least three stages: planning, execution, and review.';
        if (steps.length > 8) return 'Keep your workflow to eight stages or fewer.';
        if (steps[0].kind !== 'plan') return 'Move a planning stage to the beginning of your workflow.';
        if (steps.at(-1)?.kind !== 'review') return 'Move a review stage to the end of your workflow.';
        if (!steps.some(step => step.kind === 'execute')) return 'Add an execution stage so an agent can do the work.';
        const executors = new Set(steps.filter(step => step.kind === 'execute').flatMap(step => step.agents.map(slot => slot.agent.id)));
        let executed = false;
        for (const [index, step] of steps.entries()) {
            const label = `Stage ${index + 1}${step.name.trim() ? ` (${step.name.trim()})` : ''}`;
            if (!step.name.trim()) return `Give stage ${index + 1} a name in Stage settings.`;
            if (step.name.trim().length > 80) return `Keep the name of stage ${index + 1} to 80 characters or fewer.`;
            if (!step.agents.length) return `Add ${step.kind === 'plan' ? 'a planner' : step.kind === 'execute' ? 'an executor' : 'a reviewer'} to ${label.toLowerCase()}.`;
            if (step.agents.length > (step.kind === 'execute' ? 1 : 3)) return `${label} can have ${step.kind === 'execute' ? 'one executor' : 'up to three agents'}. Remove an agent in Stage settings.`;
            if (step.kind === 'plan') executed = false;
            if (step.kind === 'execute') {
                executed = true;
                if (step.agents[0].agent.permissionMode === 'read-only') return `Choose an executor that can edit the workspace in ${label.toLowerCase()}.`;
            }
            if (step.kind === 'review' && !executed) return `Place an execution stage before ${label.toLowerCase()} so there is work to review.`;
            if (new Set(step.agents.map(slot => slot.agent.id)).size !== step.agents.length) return `Choose a different agent for each place in ${label.toLowerCase()}.`;
            for (const slot of step.agents) {
                if (step.kind === 'review' && executors.has(slot.agent.id)) return `Choose a reviewer other than ${slot.agent.name}. Reviewers must be independent of all executors.`;
                if (!slot.assignment.trim()) return `Add an assignment for ${slot.agent.name} in ${label.toLowerCase()} → Stage settings.`;
                if (!slot.agent.name.trim() || !slot.agent.instructions.trim() || !slot.agent.model.trim()) return `Open ${slot.agent.name || 'the agent'} in ${label.toLowerCase()} and complete its name, model, and instructions.`;
            }
            if (step.checks.some(check => !check.name.trim() || !check.command.trim())) return `Complete the name and command for every check in ${label.toLowerCase()} → Stage settings, or remove the empty check.`;
        }
        return null;
    }
    if (page === 2) {
        if (!draft.criteria.trim()) return 'Describe what must be true when the workflow finishes.';
        if (!draft.checks.length) return 'Add a completion check to verify the finished work.';
        if (draft.checks.some(check => !check.name.trim() || !check.command.trim())) return 'Give every completion check a name and the command to run.';
        const limits = [
            ['planningRounds', 'Planning rounds', 1, 5], ['reviewRounds', 'Review rounds', 1, 5],
            ['turnMinutes', 'Minutes per agent turn', 1, 30], ['maxTurns', 'Total agent turns', 8, 100],
        ] as const;
        for (const [key, label, min, max] of limits) {
            if (!Number.isInteger(draft[key]) || draft[key] < min || draft[key] > max) return `${label} must be a whole number between ${min} and ${max}. Open Advanced limits to change it.`;
        }
        return null;
    }
    for (const step of [0, 1, 2]) {
        const problem = workflowWizardProblem(draft, step);
        if (problem) return problem;
    }
    const parsed = WorkflowDefinitionSchema.safeParse(draft);
    return parsed.success ? null : workflowSaveMessage(parsed.error);
}

export function workflowProblemPage(draft: WorkflowDefinition): number {
    return [0, 1, 2].find(page => workflowWizardProblem(draft, page)) ?? 3;
}

export function agentDraftProblem(agent: AgentDefinition): string | null {
    if (!agent.name.trim()) return 'Give this agent a name.';
    if (!agent.description.trim()) return 'Add a short description of what this agent does.';
    if (!agent.model.trim()) return 'Choose a model available on your machine.';
    if (!agent.instructions.trim()) return 'Add instructions so this agent knows how to work.';
    if (agent.documents.some(document => !document.name.trim())) return 'Give every reference file a filename, or remove the empty reference.';
    return null;
}

/** Do not expose Zod paths, JSON issue arrays, or transport diagnostics in a form. */
export function workflowSaveMessage(error: unknown): string {
    const issues = typeof error === 'object' && error !== null && 'issues' in error && Array.isArray(error.issues) ? error.issues as { path?: PropertyKey[]; message?: string; code?: string }[] : null;
    if (issues) {
        if (issues.some(issue => issue.message?.includes('64 KB'))) return 'This workflow is too large to save. Shorten agent instructions or reference files, then try again.';
        if (issues.some(issue => issue.message?.includes('library is too large'))) return 'Your library is full. Remove unused workflows or agents, or shorten their reference files, then try again.';
        const issue = issues[0], field = issue?.path?.at(-1);
        if (field === 'name') return 'Check that each workflow, stage, agent, and check has a name within its character limit.';
        if (field === 'command') return 'Complete each check command and keep it to 2,000 characters or fewer.';
        if (field === 'instructions' || field === 'content') return 'Shorten the agent instructions or reference content, then try saving again.';
        if (field === 'permissionMode') return 'Choose a permission mode supported by this agent’s provider.';
        if (issue?.code === 'too_big' && !issue.path?.length) return 'Your library has reached its limit. Remove an unused workflow or agent, then try again.';
        return 'Some workflow settings could not be saved. Review the team and completion checks, then try again.';
    }
    const message = error instanceof Error ? error.message : '';
    if (message.includes('changed elsewhere')) return 'This workflow or one of its agents changed on another device. Go back to Workflows and reopen it before editing again.';
    if (message.startsWith('Enable Workflows')) return 'Workflows was switched off. Enable it in Settings → Features, then save again.';
    return 'Your workflow could not be saved. Your changes are still here. Try again.';
}
