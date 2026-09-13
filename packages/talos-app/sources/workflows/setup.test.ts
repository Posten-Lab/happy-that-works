import { describe, expect, it } from 'vitest';
import { AgentLibrarySchema } from '@/agents/agentDefinition';
import { createStarterTeam, savedWorkflowTeam, workflowDraft, workflowSave, workflowStepError } from './setup';

const model = { code: 'test-model', value: 'Test model', supportedReasoningEfforts: [{ code: 'low', value: 'Low' }] };
let sequence = 0;
const team = () => createStarterTeam(model, 'low', [], () => `agent-${++sequence}`, 123);
const draft = (agents = team()) => ({ ...workflowDraft(agents, 'd80dc74b-d1f5-45b9-97c9-eb2b392b59c6', 123), name: 'Delivery', criteria: 'The check passes', checks: [{ name: 'Verify', command: 'pnpm test' }] });

describe('workflow setup', () => {
    it('creates five valid, distinct identities from an empty library with live model configuration', () => {
        const agents = team();
        expect(AgentLibrarySchema.parse(agents)).toEqual(agents);
        expect(new Set(agents.map(a => a.id)).size).toBe(5);
        expect(agents.map(a => a.permissionMode)).toEqual(['read-only', 'read-only', 'default', 'read-only', 'read-only']);
        expect(agents.every(a => a.model === 'test-model' && a.effort === 'low' && a.provider === 'codex')).toBe(true);
        expect(() => createStarterTeam(model, 'unknown', [], () => 'id')).toThrow('available');
    });
    it('avoids existing names without modifying the saved library', () => {
        const existing = team(); const before = structuredClone(existing);
        const additions = createStarterTeam(model, null, existing, () => `agent-${++sequence}`);
        expect(additions.map(a => a.name)).toEqual(['Aster 2', 'Kepler 2', 'Forge 2', 'Iris 2', 'Sentinel 2']);
        expect(existing).toEqual(before);
    });
    it('selects a writable executor and four distinct saved agents, regardless of library order', () => {
        const agents = team(); const result = savedWorkflowTeam([...agents].reverse())!;
        expect(result[2].permissionMode).toBe('default');
        expect(new Set(result.map(a => a.id)).size).toBe(5);
        expect(savedWorkflowTeam(agents.map(a => ({ ...a, permissionMode: 'read-only' })))).toBeNull();
        expect(savedWorkflowTeam([...agents.slice(0, 4), agents[0]])).toBeNull();
    });
    it('rejects invalid teams before opening the details wizard', () => {
        const agents = team();
        expect(() => workflowDraft([...agents.slice(0, 4), agents[0]], 'id')).toThrow('distinct');
        expect(() => workflowDraft(agents.map(a => ({ ...a, provider: 'claude' })), 'id')).toThrow();
    });
    it('saves edited starter identities together with the workflow and preserves existing data', () => {
        const existing = team(), additions = team(), value = draft(additions);
        value.planners[0].agent.name = 'Custom planner';
        value.planners[0].agent.instructions = 'Use actual evidence.';
        const saved = workflowSave(value, additions, existing, []);
        expect(saved.agentLibrary).toHaveLength(10);
        expect(saved.agentLibrary.slice(0, 5)).toEqual(existing);
        expect(saved.agentLibrary[5]).toMatchObject({ name: 'Custom planner', instructions: 'Use actual evidence.', avatar: 'compass' });
        expect(saved.workflowLibrary).toEqual([saved.workflow]);
        expect(additions[0].name).toBe('Aster');
    });
    it('does not retain a starter agent replaced with a saved identity', () => {
        const existing = team(), additions = team(), value = draft(additions);
        value.planners[0].agent = { ...existing[0], provider: 'codex' };
        const saved = workflowSave(value, additions, existing, []);
        expect(saved.agentLibrary).toHaveLength(9);
        expect(saved.agentLibrary.some(a => a.id === additions[0].id)).toBe(false);
    });
    it('failed validation, quota, or concurrent identity changes cannot leave orphan agents', () => {
        const additions = team(), existing = team(), workflows = [draft(existing)];
        const before = structuredClone({ existing, workflows, additions });
        expect(() => workflowSave({ ...draft(additions), criteria: '' }, additions, existing, workflows)).toThrow();
        expect(() => workflowSave(draft(additions), additions, Array.from({ length: 20 }, () => team()).flat(), workflows)).toThrow();
        expect(() => workflowSave(draft(additions), additions, additions, workflows)).toThrow('changed elsewhere');
        expect({ existing, workflows, additions }).toEqual(before);
    });
    it('keeps incomplete steps open with actionable validation', () => {
        const value = draft();
        expect(workflowStepError({ ...value, name: ' ' }, 0)).toContain('name');
        expect(workflowStepError({ ...value, executor: value.planners[0] }, 1)).toContain('different agent');
        expect(workflowStepError({ ...value, executor: { ...value.executor, agent: { ...value.executor.agent, permissionMode: 'read-only' } } }, 1)).toContain('workspace edits');
        expect(workflowStepError({ ...value, criteria: '' }, 2)).toContain('finishes');
        expect(workflowStepError({ ...value, checks: [{ name: 'Test', command: '' }] }, 2)).toContain('command');
        expect(workflowStepError(value, 2)).toBeNull();
    });
});
