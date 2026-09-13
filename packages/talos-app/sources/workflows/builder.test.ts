import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
vi.mock('expo-crypto', () => ({ randomUUID }));
import { WorkflowDefinitionSchema, WorkflowAgentSchema } from '@ahmadposten/talos-wire';
import { editableWorkflow, attachWorkflowAgent, builderAgent, newWorkflowStep, withSteps } from './builder';
import { workflowSave, workflowLibrarySettings, createStarterTeam, workflowDraft } from './setup';
function configured() {
    let draft = editableWorkflow();
    const agents = draft.steps!.map(step => builderAgent(step.name, step.kind, 'live-model', 'low'));
    draft.steps!.forEach((step, index) => { draft = attachWorkflowAgent(draft, step.id, WorkflowAgentSchema.parse(agents[index])); });
    return { draft: { ...draft, name: 'Delivery', criteria: 'Verified result', checks: [{ name: 'Verify', command: 'pnpm test' }] }, agents };
}
describe('workflow stage builder', () => {
    it('starts with empty slots and saves newly created agents in any added stage atomically', () => {
        expect(editableWorkflow().steps!.every(step => step.agents.length === 0)).toBe(true);
        const initial = configured(); const extra = newWorkflowStep('review');
        const agent = builderAgent('Final reviewer', 'review', 'live-model', 'high');
        const draft = attachWorkflowAgent(withSteps(initial.draft, [...initial.draft.steps!, extra]), extra.id, WorkflowAgentSchema.parse(agent));
        const saved = workflowSave(draft, [...initial.agents, agent], [], []);
        expect(workflowLibrarySettings(saved.workflowLibrary).workflowLibrary).toEqual([]);
        expect(workflowLibrarySettings(saved.workflowLibrary).workflowLibraryV2).toHaveLength(1);
        expect(saved.agentLibrary).toHaveLength(4); expect(saved.workflow.steps).toHaveLength(4);
        expect(saved.workflow.reviewers[0].agent.name).toBe('Final reviewer');
    });
    it('retains only referenced candidates after replacing, removing, and reordering', () => {
        const { draft, agents } = configured(); const replacement = builderAgent('Replacement', 'plan', 'live-model', null);
        const changed = attachWorkflowAgent(draft, draft.steps![0].id, WorkflowAgentSchema.parse(replacement), 0);
        const saved = workflowSave(changed, [...agents, replacement], [], []);
        expect(saved.agentLibrary.map(a => a.id)).not.toContain(agents[0].id);
        expect(saved.agentLibrary).toHaveLength(3);
        expect(() => workflowSave(withSteps(changed, [...changed.steps!].reverse()), saved.agentLibrary, [], [])).toThrow();
    });
    it('converts existing workflows to editable steps without changing their snapshots or source', () => {
        const team = createStarterTeam({ code: 'model', value: 'Model' }, null, [], randomUUID);
        const legacy = { ...workflowDraft(team, randomUUID()), name: 'Old', criteria: 'Verified', checks: [{ name: 'Test', command: 'pnpm test' }] };
        const upgraded = editableWorkflow(legacy);
        expect(WorkflowDefinitionSchema.parse(upgraded).steps).toHaveLength(3);
        expect(upgraded.planners).toEqual(legacy.planners); expect(legacy.steps).toBeUndefined();
    });
});
