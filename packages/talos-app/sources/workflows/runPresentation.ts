import type { WorkflowRun, WorkflowSlot, WorkflowStage, WorkflowTask } from '@ahmadposten/talos-wire';

export type WorkflowPane = 'Team' | 'Work' | 'Review' | 'Activity';
export type RunStep = { id: string; name: string; kind: 'plan' | 'execute' | 'review'; agents: WorkflowSlot[]; state: 'passed' | 'current' | 'waiting' | 'stopped' };

export function workflowRunSteps(run: WorkflowRun): { steps: RunStep[]; currentIndex: number } {
    const definition = run.definition;
    const items = definition.steps ?? [
        { id: 'plan', name: 'Plan', kind: 'plan' as const, agents: definition.planners },
        { id: 'execute', name: 'Build', kind: 'execute' as const, agents: [definition.executor] },
        { id: 'review', name: 'Review', kind: 'review' as const, agents: definition.reviewers },
    ];
    const currentIndex = definition.steps ? run.stepIndex ?? 0 : run.stage === 'execute' ? 1 : run.stage === 'review' || run.stage === 'verify' ? 2 : 0;
    return { currentIndex, steps: items.map((step, index) => ({ ...step, state: run.status === 'complete' || (definition.steps ? run.completedSteps?.includes(step.id) : index < currentIndex) ? 'passed' : index === currentIndex ? run.status === 'cancelled' ? 'stopped' : 'current' : 'waiting' })) };
}

export function workflowDefaultPane(run: WorkflowRun): WorkflowPane {
    if (run.status === 'complete') return 'Work';
    return run.stage === 'execute' ? 'Work' : run.stage === 'review' || run.stage === 'verify' ? 'Review' : 'Team';
}

export function workflowCurrentParticipants(run: WorkflowRun): { slot: WorkflowSlot; task?: WorkflowTask }[] {
    const { steps, currentIndex } = workflowRunSteps(run);
    const current = steps[currentIndex];
    if (!current) return [];
    const tasks = run.tasks.filter(task => current.agents.some(slot => slot.agent.id === task.agentId)
        && (!run.definition.steps || task.stepId === current.id && task.attempt === run.stepAttempt));
    return current.agents.map(slot => ({ slot, task: [...tasks].reverse().find(task => task.agentId === slot.agent.id) }));
}

const doneLabels: Record<WorkflowStage, string> = { propose: 'Proposed', consolidate: 'Plan ready', plan_vote: 'Approved', execute: 'Finished', verify: 'Checked', review: 'Approved' };
export function workflowParticipantState(run: WorkflowRun, task?: WorkflowTask): string {
    if (task?.status !== 'done' && run.status === 'cancelled') return 'Stopped';
    if (task?.status !== 'done' && run.status === 'paused') return 'Paused';
    if (task?.status === 'interrupted') return 'Interrupted';
    if (task?.status === 'running') return run.status === 'running' ? 'Working' : 'Waiting for you';
    if (task?.result?.decision === 'approve' && task.result.findings.some(f => f.blocking)) return 'Blocking findings';
    if (task?.result?.decision === 'changes') return 'Changes requested';
    if (task?.result?.decision === 'information') return 'Needs your input';
    if (task?.result?.decision === 'replan') return 'Replan requested';
    return task?.status === 'done' ? doneLabels[task.stage] : 'Ready';
}
