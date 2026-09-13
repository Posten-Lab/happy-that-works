import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { WorkflowDefinitionSchema, WorkflowRunSchema, workflowProjection, type WorkflowDefinition } from './workflows';
function fixture(): WorkflowDefinition {
    const slot = (id: string) => ({ assignment: 'Do the assigned work.', agent: { id, revision: 1, name: id, description: '', provider: 'codex' as const, model: 'model', effort: null, permissionMode: 'default' as const, instructions: 'Follow instructions.', documents: [] } });
    const steps = [
        { id: randomUUID(), name: 'Plan', kind: 'plan' as const, agents: [slot('planner')], criteria: '', checks: [] },
        { id: randomUUID(), name: 'Build', kind: 'execute' as const, agents: [slot('executor')], criteria: '', checks: [] },
        { id: randomUUID(), name: 'Review', kind: 'review' as const, agents: [slot('reviewer')], criteria: '', checks: [] },
    ];
    return WorkflowDefinitionSchema.parse({ id: randomUUID(), revision: 1, name: 'Delivery', description: '', steps, ...workflowProjection(steps), criteria: 'Correct result', checks: [{ name: 'Check', command: 'test -f result.txt' }], planningRounds: 3, reviewRounds: 3, turnMinutes: 10, maxTurns: 60, approvePlan: false, updatedAt: 1 });
}
const parseSteps = (d: WorkflowDefinition) => WorkflowDefinitionSchema.parse({ ...d, ...workflowProjection(d.steps!) });
describe('editable workflow contract', () => {
    it('accepts one participant and up to three distinct consensus participants', () => {
        const d = fixture(); expect(parseSteps(d)).toEqual(d);
        d.steps![0].agents.push(...['second','third'].map(id => ({ ...d.planners[0], agent: { ...d.planners[0].agent, id } })));
        expect(parseSteps(d).planners).toHaveLength(3);
        d.steps![0].agents.push({ ...d.planners[0], agent: { ...d.planners[0].agent, id: 'fourth' } });
        expect(() => parseSteps(d)).toThrow();
    });
    it('keeps legacy minimums and rejects contradictory role summaries', () => {
        const d = fixture(); delete d.steps; expect(() => WorkflowDefinitionSchema.parse(d)).toThrow('at least two');
        const staged = fixture(); staged.executor = staged.planners[0]; expect(() => WorkflowDefinitionSchema.parse(staged)).toThrow('summaries');
    });
    it('rejects missing agents, invalid ordering, duplicate stages, multiple writers in a step, and self-review', () => {
        for (const change of [
            (d: WorkflowDefinition) => { d.steps![0].agents = []; },
            (d: WorkflowDefinition) => { d.steps!.reverse(); },
            (d: WorkflowDefinition) => { d.steps!.splice(2, 0, { ...d.steps![0], id: randomUUID() }); },
            (d: WorkflowDefinition) => { d.steps![2].id = d.steps![0].id; },
            (d: WorkflowDefinition) => { d.steps![1].agents.push(d.planners[0]); },
            (d: WorkflowDefinition) => { d.steps![2].agents = [d.executor]; },
            (d: WorkflowDefinition) => { d.steps![1].agents[0].agent.permissionMode = 'read-only'; },
        ]) { const d = fixture(); change(d); expect(() => parseSteps(d)).toThrow(); }
    });
    it('permits reuse across stages only with a consistent snapshot', () => {
        const d = fixture(); d.steps!.push({ ...structuredClone(d.steps![2]), id: randomUUID(), name: 'Final review' });
        expect(parseSteps(d).steps).toHaveLength(4);
        d.steps![3].agents[0].agent.model = 'different'; expect(() => parseSteps(d)).toThrow('same configuration');
    });
    it('rejects incomplete recovery state for custom-stage runs', () => {
        expect(() => WorkflowRunSchema.parse({ id: randomUUID(), revision: 1, definition: fixture(), machineId: 'machine', task: 'Build', sourceDirectory: '/src', directory: '/work', branch: 'branch', baseCommit: 'base', status: 'paused', stage: 'propose', planningRound: 1, reviewRound: 1, planVersion: 1, plan: '', artifactVersion: '', reason: '', tasks: [], checks: [], events: [], notes: [], approvedPlanVersion: null, createdAt: 1, updatedAt: 1 })).toThrow('recovery state');
    });
});
