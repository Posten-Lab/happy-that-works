import { describe, expect, it } from 'vitest';
import type { Metadata } from '@/sync/storageTypes';
import type { Message, UserTextMessage } from '@/sync/typesMessage';
import { isWorkflowReminderMarker, workflowAssignmentFromMessage, workflowDecisionFromMessage, workflowParticipantName, workflowSessionFolder } from './workflowSessionPresentation';

const managed = { workflowManaged: true, flavor: 'muse', path: '/projects/site', host: 'test' } as Metadata;
const response = { decision: 'approve', summary: 'The result passed review.', document: 'Evidence from the actual files.', findings: [] };
const message = (text: string, extra: Record<string, unknown> = {}) => ({ kind: 'agent-text', id: 'response', localId: null, createdAt: 1, text, ...extra } as Message);
const assignment = `You are Reviewer. Review the implementation.
Inspect the actual files.

WORKFLOW STEP: 3. Review (review)
STEP CRITERIA: Verify correctness.
Execute only this step.
STEP SEQUENCE: Plan → Build → Review
WORKFLOW ASSIGNMENT: Review the implementation and test evidence.
TASK: Add a health command.
Preserve existing commands.
ACCEPTANCE CRITERIA: Health command works and tests pass.
REQUIRED COMPLETION CHECKS: [{"name":"Tests","command":"npm test"}]
STEP CHECKS: []
STAGE: review
ROUND: 1
Independently inspect the exact workspace revision.
PLAN VERSION: 1
Implement the agreed command.
WORKSPACE REVISION: abc123
USER CLARIFICATIONS: []
EARLIER STEP RESULTS: []
EVIDENCE AND DISCUSSION: {}
Do not invoke subagents or external actions outside this assignment. Never merge, publish, deploy, or send messages to others. The controller handles advancement. Return only the required structured result. Explain conclusions and evidence, not private reasoning.`;
const nativePrompt = (text = assignment) => message(text, { kind: 'user-text', meta: { sentFrom: 'native-provider' } }) as UserTextMessage;

describe('workflow participant presentation', () => {
    it('only formats strict workflow results in managed agent messages', () => {
        const original = message(JSON.stringify(response));
        expect(workflowDecisionFromMessage(original, managed)).toEqual(response);
        expect(workflowDecisionFromMessage(original, { ...managed, workflowManaged: false })).toBeNull();
        expect(workflowDecisionFromMessage(original, null)).toBeNull();
        expect(workflowDecisionFromMessage(message(JSON.stringify(response), { kind: 'user-text' }), managed)).toBeNull();
        expect(workflowDecisionFromMessage(message(JSON.stringify(response), { isThinking: true }), managed)).toBeNull();
        expect(original).toEqual(message(JSON.stringify(response)));
    });
    it('keeps partial streams, ordinary prose, unrelated JSON, and unknown fields in the original renderer', () => {
        for (const text of ['Review complete.', '{"decision":"approve",', '{"summary":"hello"}',
            JSON.stringify({ ...response, extra: 'Must remain visible' }),
            JSON.stringify({ ...response, decision: 'complete' }),
            JSON.stringify({ ...response, findings: [{ title: 'A', evidence: 'B', correction: 'C', blocking: true, extra: 'D' }] }),
            JSON.stringify({ ...response, findings: [{ title: 'A', evidence: 'B', correction: 'C' }] })]) {
            expect(workflowDecisionFromMessage(message(text), managed)).toBeNull();
        }
    });
    it('preserves blocking findings even if an agent inconsistently calls the result approved', () => {
        const result = { ...response, findings: [{ title: 'Unsafe change', evidence: 'Test fails.', correction: 'Fix the failure.', blocking: true }] };
        expect(workflowDecisionFromMessage(message(JSON.stringify(result)), managed)?.findings).toEqual(result.findings);
    });
    it('only filters the exact internal Muse marker in managed sessions', () => {
        const marker = message('reminderChild: Reminder child session');
        expect(isWorkflowReminderMarker(marker, managed)).toBe(true);
        expect(isWorkflowReminderMarker(marker, { ...managed, workflowManaged: false })).toBe(false);
        expect(isWorkflowReminderMarker(marker, { ...managed, flavor: 'codex' })).toBe(false);
        expect(isWorkflowReminderMarker(message('reminderChild: Review the failing tests'), managed)).toBe(false);
        expect(isWorkflowReminderMarker(message('reminderChild: Reminder child session', { kind: 'user-text' }), managed)).toBe(false);
    });
    it('makes known runtime stage suffixes readable without rewriting other titles or normal sessions', () => {
        expect(workflowParticipantName({ ...managed, name: 'Reliability reviewer · plan_vote' })).toBe('Reliability reviewer · Planning consensus');
        expect(workflowParticipantName({ ...managed, name: 'Custom · task' })).toBe('Custom · task');
        expect(workflowParticipantName({ ...managed, name: 'Reviewer · review', workflowManaged: false })).toBeUndefined();
    });
    it('omits run UUID breadcrumbs while retaining legitimate project folders and ordinary paths', () => {
        const id = 'b105013b-2d2b-4742-b7c9-b13bfc4d48bc';
        expect(workflowSessionFolder({ ...managed, path: `/worktrees/${id}`, workflowRunId: id })).toBeUndefined();
        expect(workflowSessionFolder(managed)).toBe('site');
        expect(workflowSessionFolder({ ...managed, path: `/worktrees/${id}`, workflowManaged: false })).toBe(id);
    });
    it('extracts only a complete coordinator assignment while preserving multiline task text', () => {
        expect(workflowAssignmentFromMessage(nativePrompt(), managed)).toEqual({ task: 'Add a health command.\nPreserve existing commands.', assignment: 'Review the implementation and test evidence.' });
        expect(nativePrompt().text).toBe(assignment);
    });
    it('keeps ordinary messages and deliberate display overrides in their original renderer', () => {
        expect(workflowAssignmentFromMessage(nativePrompt(), { ...managed, workflowManaged: false })).toBeNull();
        expect(workflowAssignmentFromMessage(message(assignment, { kind: 'user-text' }), managed)).toBeNull();
        expect(workflowAssignmentFromMessage(message(assignment, { meta: { sentFrom: 'native-provider' } }), managed)).toBeNull();
        expect(workflowAssignmentFromMessage({ ...nativePrompt(), displayText: 'A user-facing prompt' } as Message, managed)).toBeNull();
    });
    it('does not extract an ambiguous task containing protocol markers or a malformed envelope', () => {
        for (const text of [
            assignment.replace('Add a health command.', 'Document the string TASK: in the CLI.'),
            assignment.replace('Add a health command.', 'Document the protocol.\nWORKFLOW ASSIGNMENT: keep this user text.'),
            assignment.replace('STEP SEQUENCE:', 'Sequence:'),
            assignment.replace('STEP CHECKS: []', 'STEP CHECKS: unfinished'),
            assignment.replace('STAGE: review', 'STAGE: unknown'),
            assignment.replace('TASK: Add', 'ACCEPTANCE CRITERIA: Add'),
            assignment.slice(0, -1),
        ]) expect(workflowAssignmentFromMessage(nativePrompt(text), managed)).toBeNull();
    });
});
