import { describe, expect, it } from 'vitest';
import type { WorkflowRun, WorkflowTask } from '@ahmadposten/talos-wire';
import { workflowCurrentParticipants, workflowDefaultPane, workflowParticipantState, workflowRunSteps } from './runPresentation';

const slot = (id: string) => ({ agent: { id, name: id, provider: 'codex' }, assignment: 'A task' });
function run(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
    return { status: 'running', stage: 'propose', definition: { planners: [slot('planner-a'), slot('planner-b')], executor: slot('executor'), reviewers: [slot('reviewer-a'), slot('reviewer-b')] }, tasks: [], ...overrides } as WorkflowRun;
}
const task = (overrides: Partial<WorkflowTask> = {}) => ({ id: 'task', agentId: 'planner-a', status: 'running', stage: 'propose', ...overrides } as WorkflowTask);
const staged = () => ({ ...run().definition, steps: [{ id: 'plan', name: 'Plan', kind: 'plan', agents: [slot('planner-a')] }, { id: 'build', name: 'Build', kind: 'execute', agents: [slot('executor')] }, { id: 'review', name: 'Review', kind: 'review', agents: [slot('reviewer-a')] }] } as WorkflowRun['definition']);

describe('workflow run presentation', () => {
    it('uses the current phase for legacy progress without losing the legacy team', () => {
        const value = run({ stage: 'execute' });
        expect(workflowRunSteps(value).currentIndex).toBe(1);
        expect(workflowRunSteps(value).steps.map(step => step.state)).toEqual(['passed', 'current', 'waiting']);
        expect(workflowCurrentParticipants(value).map(item => item.slot.agent.id)).toEqual(['executor']);
    });
    it('does not claim unfinished stages passed when a run stops', () => {
        const value = run({ definition: staged(), stepIndex: 1, stepAttempt: 2, completedSteps: ['plan'], status: 'cancelled', stage: 'execute' });
        expect(workflowRunSteps(value).steps.map(step => step.state)).toEqual(['passed', 'stopped', 'waiting']);
        expect(workflowRunSteps({ ...value, status: 'complete' }).steps.every(step => step.state === 'passed')).toBe(true);
    });
    it('highlights actual active agents and excludes stale tasks from another attempt', () => {
        const active = task({ id: 'new', stepId: 'plan', attempt: 2 });
        const stale = task({ id: 'old', stepId: 'plan', attempt: 1 });
        const value = run({ definition: staged(), stepIndex: 0, stepAttempt: 2, tasks: [active, stale] });
        expect(workflowCurrentParticipants(value)[0].task?.id).toBe('new');
        expect(workflowCurrentParticipants(run({ tasks: [task()] })).map(item => item.slot.agent.id)).toEqual(['planner-a']);
    });
    it('never describes an agent as working when the workflow is paused or cancelled', () => {
        expect(workflowParticipantState(run({ status: 'paused' }), task())).toBe('Paused');
        expect(workflowParticipantState(run({ status: 'cancelled' }), task())).toBe('Stopped');
        expect(workflowParticipantState(run({ status: 'needs_input' }), task())).toBe('Waiting for you');
        expect(workflowParticipantState(run(), task({ status: 'interrupted' }))).toBe('Interrupted');
    });
    it('offers a useful automatic pane for each phase and final output', () => {
        expect(workflowDefaultPane(run({ stage: 'plan_vote' }))).toBe('Plan');
        expect(workflowDefaultPane(run({ stage: 'execute' }))).toBe('Work');
        expect(workflowDefaultPane(run({ stage: 'verify' }))).toBe('Review');
        expect(workflowDefaultPane(run({ stage: 'review', status: 'complete' }))).toBe('Work');
    });
});
