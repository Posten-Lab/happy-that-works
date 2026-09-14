import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { settingsParse } from '@/sync/settings';
import { randomUUID } from 'node:crypto';
vi.mock('expo-crypto', () => ({ randomUUID }));
import { workflowSlots, WorkflowDefinitionSchema, WorkflowAgentSchema } from '@ahmadposten/talos-wire';
import { editableWorkflow, attachWorkflowAgent, builderAgent, newWorkflowStep, withSteps } from './builder';
import { workflowSave, workflowLibrarySettings, createStarterTeam, workflowDraft } from './setup';
function configured() {
    let draft = editableWorkflow();
    const agents = draft.steps!.map(step => builderAgent(step.name, step.kind, 'live-model', 'low'));
    draft.steps!.forEach((step, index) => { draft = attachWorkflowAgent(draft, step.id, WorkflowAgentSchema.parse(agents[index])); });
    return { draft: { ...draft, name: 'Delivery', criteria: 'Verified result', checks: [{ name: 'Verify', command: 'pnpm test' }] }, agents };
}
describe('workflow stage builder', () => {
    it('stores YOLO and long-reference workflows in a field older clients preserve', () => {
        const { draft } = configured();
        for (const patch of [{ permissionMode: 'yolo' as const }, { documents: [{ name: 'large.md', content: 'x'.repeat(20000) }] }]) {
            const agent = { ...draft.executor.agent, ...patch };
            const changed = { ...attachWorkflowAgent(draft, draft.steps![1].id, agent, 0), id: randomUUID() };
            const fields = workflowLibrarySettings([draft, changed]);
            expect(fields.workflowLibraryV2).toEqual([draft]);
            expect(fields.workflowLibraryV4).toEqual([changed]);
            expect(fields.workflowLibraryV3).toEqual([]);
            // A settings update retains unknown versioned fields as opaque data.
            const oldWorkflow = WorkflowDefinitionSchema.refine(w => workflowSlots(w).every(slot => slot.agent.permissionMode !== 'yolo' && slot.agent.documents.every(d => d.content.length <= 16000)));
            const oldSettings = z.object({ workflowLibrary: z.array(oldWorkflow), workflowLibraryV2: z.array(oldWorkflow), workflowLibraryV3: z.array(oldWorkflow) }).passthrough();
            const restored = settingsParse({ ...oldSettings.parse(fields), experiments: true });
            expect(restored.workflowLibraryV4[0].executor.agent).toEqual(agent);
        }
    });
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
