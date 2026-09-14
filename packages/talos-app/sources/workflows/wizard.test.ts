import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { WorkflowAgentSchema, WorkflowDefinitionSchema } from '@ahmadposten/talos-wire';
import { editableWorkflow, attachWorkflowAgent, builderAgent, withSteps, newWorkflowStep } from './builder';
import { agentDraftProblem, workflowProblemPage, workflowSaveMessage, workflowWizardProblem } from './wizard';

vi.mock('expo-crypto', () => ({ randomUUID }));

function configured() {
    let draft = editableWorkflow();
    draft.steps!.forEach(step => { draft = attachWorkflowAgent(draft, step.id, WorkflowAgentSchema.parse(builderAgent(step.name, step.kind, 'available-model', 'low'))); });
    return { ...draft, name: 'Release', criteria: 'The task passes review and verification.', checks: [{ name: 'Tests', command: 'pnpm test' }] };
}

describe('workflow wizard validation', () => {
    it('allows Basics before team and checks exist, and directs an empty team to its first missing role', () => {
        const draft = { ...editableWorkflow(), name: 'My workflow' };
        expect(workflowWizardProblem(draft, 0)).toBeNull();
        expect(workflowWizardProblem(draft, 1)).toContain('Add a planner');
        expect(workflowProblemPage(draft)).toBe(1);
        expect(workflowWizardProblem({ ...draft, name: '  ' }, 0)).toContain('name');
    });

    it('checks all editable stages rather than only the legacy role projection', () => {
        const draft = configured();
        const extraReview = newWorkflowStep('review');
        const edited = withSteps(draft, [...draft.steps!, extraReview]);
        expect(workflowWizardProblem(edited, 1)).toContain('stage 4');
        const reviewer = builderAgent('Second reviewer', 'review', 'model', null);
        expect(workflowWizardProblem(attachWorkflowAgent(edited, extraReview.id, reviewer), 1)).toBeNull();
    });

    it('explains invalid ordering and permissions without schema paths', () => {
        const draft = configured();
        expect(workflowWizardProblem(withSteps(draft, [...draft.steps!].reverse()), 1)).toContain('planning stage to the beginning');
        const reordered = withSteps(draft, [draft.steps![0], draft.steps![2], draft.steps![1], { ...newWorkflowStep('review'), agents: draft.steps![2].agents }]);
        expect(workflowWizardProblem(reordered, 1)).toContain('execution stage before');
        const readonly = withSteps(draft, draft.steps!.map(step => step.kind !== 'execute' ? step : { ...step, agents: step.agents.map(slot => ({ ...slot, agent: { ...slot.agent, permissionMode: 'read-only' as const } })) }));
        expect(workflowWizardProblem(readonly, 1)).toContain('executor that can edit');
    });

    it('requires independent reviewers and distinct agents within each stage', () => {
        const draft = configured();
        const sharedReviewer = withSteps(draft, draft.steps!.map(step => step.kind !== 'review' ? step : { ...step, agents: [draft.steps![1].agents[0]] }));
        expect(workflowWizardProblem(sharedReviewer, 1)).toContain('independent of all executors');
        const duplicate = withSteps(draft, draft.steps!.map(step => step.kind !== 'plan' ? step : { ...step, agents: [step.agents[0], step.agents[0]] }));
        expect(workflowWizardProblem(duplicate, 1)).toContain('different agent for each place');
    });

    it('identifies missing assignments and review gate commands at the correct stage', () => {
        const draft = configured();
        const missingAssignment = withSteps(draft, draft.steps!.map(step => step.kind !== 'execute' ? step : { ...step, agents: step.agents.map(slot => ({ ...slot, assignment: ' ' })) }));
        expect(workflowWizardProblem(missingAssignment, 1)).toContain('assignment');
        const missingCommand = withSteps(draft, draft.steps!.map(step => step.kind !== 'review' ? step : { ...step, checks: [{ name: 'Lint', command: '' }] }));
        expect(workflowWizardProblem(missingCommand, 1)).toContain('stage 3');
    });

    it('requires an explicit finish line and checks and bounds advanced limits', () => {
        const draft = configured();
        expect(workflowWizardProblem({ ...draft, criteria: '' }, 2)).toContain('finishes');
        expect(workflowWizardProblem({ ...draft, checks: [] }, 2)).toContain('completion check');
        expect(workflowWizardProblem({ ...draft, checks: [{ name: '', command: 'pnpm test' }] }, 2)).toContain('name and the command');
        for (const value of [NaN, 0, 31, 1.5]) expect(workflowWizardProblem({ ...draft, turnMinutes: value }, 2)).toContain('whole number between 1 and 30');
        expect(workflowWizardProblem({ ...draft, maxTurns: 7 }, 2)).toContain('between 8 and 100');
        expect(workflowWizardProblem(draft, 3)).toBeNull();
    });

    it('keeps wire schema as the final save boundary and translates size failures', () => {
        const draft = configured();
        const huge = withSteps(draft, draft.steps!.map(step => ({ ...step, agents: step.agents.map(slot => ({ ...slot, agent: { ...slot.agent, instructions: 'x'.repeat(24000) } })) })));
        expect(workflowWizardProblem(huge, 1)).toBeNull();
        expect(workflowWizardProblem(huge, 3)).toContain('too large to save');
        const malformed = WorkflowDefinitionSchema.safeParse({ ...draft, checks: [{ name: 'Test', command: 'x'.repeat(2001) }] });
        expect(malformed.success).toBe(false);
        if (!malformed.success) expect(workflowSaveMessage(malformed.error)).toContain('2,000 characters');
    });

    it('returns actionable agent and save errors while withholding raw diagnostics', () => {
        const agent = builderAgent('Planner', 'plan', 'model', null);
        expect(agentDraftProblem({ ...agent, description: '' })).toContain('description');
        expect(agentDraftProblem({ ...agent, model: '' })).toContain('Choose a model');
        expect(agentDraftProblem({ ...agent, documents: [{ name: '', content: '' }] })).toContain('filename');
        expect(workflowSaveMessage(new Error('A starter agent changed elsewhere.'))).toContain('another device');
        expect(workflowSaveMessage(new Error('HTTP 500, private details'))).not.toContain('private details');
    });
});
