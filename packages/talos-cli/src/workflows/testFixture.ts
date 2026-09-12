import { randomUUID } from 'node:crypto';
import type { WorkflowDefinition } from '@ahmadposten/talos-wire';
export function definition(): WorkflowDefinition {
    const slot = (id: string) => ({ assignment: `Assignment ${id}`, agent: { id, revision: 1, name: id, provider: 'codex' as const, model: 'test-model', effort: 'low', permissionMode: 'default' as const, description: '', instructions: 'Do your assignment.', documents: [] } });
    return { id: randomUUID(), revision: 1, name: 'Test team', description: '', planners: [slot('planner-a'), slot('planner-b')], executor: slot('executor'), reviewers: [slot('reviewer-a'), slot('reviewer-b')], criteria: 'Produce a verified result.', checks: [{ name: 'Verification', command: 'test -f result.txt' }], planningRounds: 3, reviewRounds: 3, turnMinutes: 1, maxTurns: 60, approvePlan: false, updatedAt: 1 };
}
