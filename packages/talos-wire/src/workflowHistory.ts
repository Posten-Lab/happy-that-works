import type { WorkflowDecision, WorkflowRun, WorkflowTask } from './workflows';

export const workflowFindingId = (task: WorkflowTask, index: number) => `${task.id}:${index}`;
export const workflowCleanApproval = (task?: WorkflowTask) => task?.status === 'done'
    && task.result?.decision === 'approve' && !task.result.findings.some(f => f.blocking);

/** A response is evidence only if the author actually received the finding.
 * Verification belongs to its original assessor, never the plan owner. */
export function validWorkflowResponses(tasks: WorkflowTask[], task: WorkflowTask, result: WorkflowDecision) {
    return (result.findingResponses ?? []).filter(response => {
        if (!response.evidence.trim()) return false;
        const source = tasks.find(t => t.result?.findings.some((_, i) => workflowFindingId(t, i) === response.findingId));
        if (!source || source.id === task.id || source.status !== 'done'
            || source.stepId !== task.stepId || source.attempt !== task.attempt
            || !task.inputs?.some(input => input.taskId === source.id && ['result', 'findings'].includes(input.content))) return false;
        if (response.status === 'addressed') return task.stage === 'consolidate' || task.stage === 'execute';
        if (source.agentId !== task.agentId || !(task.stage === source.stage || task.stage === 'plan_vote' && ['propose', 'consolidate'].includes(source.stage))) return false;
        return response.status === 'open' || result.decision === 'approve' && !result.findings.some(f => f.blocking);
    });
}

export type WorkflowObjection = {
    id: string;
    task: WorkflowTask;
    finding: WorkflowDecision['findings'][number];
    status: 'open' | 'addressed' | 'verified';
    responses: { task: WorkflowTask; status: 'open' | 'addressed' | 'verified'; evidence: string }[];
};

export function workflowObjections(tasks: WorkflowTask[]): WorkflowObjection[] {
    const objections: WorkflowObjection[] = [];
    for (const task of tasks) {
        if (task.status !== 'done' || !task.result) continue;
        for (const response of validWorkflowResponses(tasks.slice(0, tasks.indexOf(task)), task, task.result)) {
            const objection = objections.find(item => item.id === response.findingId);
            if (!objection) continue;
            // A later plan-owner response cannot undo an assessor's verification.
            if (response.status === 'addressed' && objection.status === 'verified') continue;
            objection.status = response.status;
            objection.responses.push({ task, status: response.status, evidence: response.evidence });
        }
        task.result.findings.forEach((finding, index) => {
            if (finding.blocking) objections.push({ id: workflowFindingId(task, index), task, finding, status: 'open', responses: [] });
        });
    }
    return objections;
}

/** One gate column is an exact step / attempt / round / artifact version. */
export function workflowVoteGroups(tasks: WorkflowTask[]) {
    const groups = new Map<string, { key: string; version: string; round: number; attempt?: number; participants?: WorkflowTask['participants']; tasks: WorkflowTask[] }>();
    for (const task of tasks.filter(t => t.stage === 'plan_vote' || t.stage === 'review' || t.stage === 'consolidate' && t.status === 'done')) {
        const key = JSON.stringify([task.stepId, task.attempt, task.stage === 'consolidate' ? 'plan_vote' : task.stage, task.round, task.version]);
        if (!groups.has(key)) groups.set(key, { key, version: task.version, round: task.round, attempt: task.attempt, participants: task.participants, tasks: [] });
        const group = groups.get(key)!;
        if (task.stage === 'consolidate') continue;
        // The latest attempt by an agent supersedes its previous result, even if interrupted.
        group.tasks = [...group.tasks.filter(t => t.agentId !== task.agentId), task];
    }
    return [...groups.values()];
}

export function workflowTaskInStep(task: WorkflowTask, stepId: string, run: WorkflowRun) {
    if (run.definition.steps) return task.stepId === stepId;
    return stepId === 'plan' ? ['propose', 'consolidate', 'plan_vote'].includes(task.stage)
        : stepId === 'execute' ? task.stage === 'execute' : task.stage === 'review';
}
