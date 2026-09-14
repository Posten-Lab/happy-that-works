import { describe, expect, it } from 'vitest';
import { WorkflowDecisionSchema, WorkflowTaskSchema, type WorkflowDecision, type WorkflowTask } from './workflows';
import { workflowCleanApproval, workflowFindingId, workflowObjections, workflowVoteGroups } from './workflowHistory';
const result = (overrides: Partial<WorkflowDecision> = {}): WorkflowDecision => ({ decision: 'approve', summary: 'Evidence', document: '', findings: [], ...overrides });
const task = (id: string, overrides: Partial<WorkflowTask> = {}): WorkflowTask => ({ id, agentId: 'ben', agentName: 'Ben', stage: 'plan_vote', round: 1, version: 'plan:1', status: 'done', startedAt: 1, assignment: '', prompt: '', result: result(), ...overrides });
const objection = task('objection', { result: result({ decision: 'changes', findings: [{ title: 'Duplicate orders', evidence: 'Retries repeat writes', correction: 'Use a key', blocking: true }] }) });
const id = workflowFindingId(objection, 0);
const response = (name: string, status: 'addressed' | 'verified' | 'open', overrides: Partial<WorkflowTask> = {}) => task(name, { round: 2, version: 'plan:2', inputs: [{ taskId: objection.id, content: 'findings' }], result: result({ findingResponses: [{ findingId: id, status, evidence: 'The plan now requires a unique key.' }] }), ...overrides });

describe('workflow evidence history', () => {
    it('preserves old tasks and results without fabricating provenance', () => {
        expect(WorkflowTaskSchema.parse(task('old')).inputs).toBeUndefined();
        expect(WorkflowDecisionSchema.parse(result()).findingResponses).toBeUndefined();
        expect(workflowObjections([objection, task('unrelated-approval', { version: 'plan:2' })])[0].status).toBe('open');
    });
    it('requires a response from the original assessor after the owner addresses a finding', () => {
        const addressed = response('addressed', 'addressed', { agentId: 'ada', stage: 'consolidate' });
        expect(workflowObjections([objection, addressed])[0].status).toBe('addressed');
        const verified = response('verified', 'verified');
        const history = workflowObjections([objection, addressed, verified])[0];
        expect(history.status).toBe('verified');
        expect(history.responses.map(item => item.task.id)).toEqual(['addressed', 'verified']);
        expect(workflowObjections([objection, addressed, verified, response('reopened', 'open', { result: result({ decision: 'changes', findingResponses: [{ findingId: id, status: 'open', evidence: 'Regression' }] }) })])[0].status).toBe('open');
    });
    it.each([
        { agentId: 'ada' }, { inputs: [] }, { inputs: [{ taskId: objection.id, content: 'summary' as const }] },
        { attempt: 2 }, { stepId: 'other-step' }, { status: 'running' as const },
        { result: result({ decision: 'changes', findingResponses: [{ findingId: id, status: 'verified', evidence: 'Claim' }] }) },
        { result: result({ findings: objection.result!.findings, findingResponses: [{ findingId: id, status: 'verified', evidence: 'Claim' }] }) },
    ])('does not accept unsupported verification: %j', overrides => {
        expect(workflowObjections([objection, response('false', 'verified', overrides)])[0].status).toBe('open');
    });
    it('allows the original planner to verify a proposal objection when voting', () => {
        expect(workflowObjections([{ ...objection, stage: 'propose' }, response('vote', 'verified')])[0].status).toBe('verified');
    });
    it('does not let a later plan-owner response undo verified evidence', () => {
        expect(workflowObjections([objection, response('verified', 'verified'), response('late-owner', 'addressed', { stage: 'consolidate', agentId: 'ada' })])[0].status).toBe('verified');
    });
    it('does not carry votes between versions, attempts, or steps and includes a pending new plan', () => {
        const groups = workflowVoteGroups([task('v1'), task('v2-plan', { stage: 'consolidate', version: 'plan:2' }), task('retry', { attempt: 2 }), task('other', { stepId: 'other' })]);
        expect(groups).toHaveLength(4);
        expect(groups[1].tasks).toEqual([]);
        expect(groups[0].tasks.map(t => t.id)).toEqual(['v1']);
    });
    it('a later interrupted vote supersedes approval, and blocking approval is never clean', () => {
        const groups = workflowVoteGroups([task('approve'), task('retry', { status: 'interrupted' })]);
        expect(groups[0].tasks.map(t => t.id)).toEqual(['retry']);
        expect(workflowCleanApproval(groups[0].tasks[0])).toBe(false);
        expect(workflowCleanApproval(task('bad', { result: result({ findings: objection.result!.findings }) }))).toBe(false);
    });
});
