import { AgentLibrarySchema, type AgentDefinition } from '@/agents/agentDefinition';
import type { ProviderModel } from '@/sync/ops';
import { WorkflowDefinitionSchema, WorkflowLibrarySchema, type WorkflowDefinition, WorkflowAgentSchema, workflowSlots, workflowNeedsProviders } from '@ahmadposten/talos-wire';

const roles = [
    { name: 'Aster', description: 'Plans the user experience and acceptance criteria', avatar: 'compass', specialties: ['design'], instructions: 'Independently identify the user goal, acceptance criteria, and practical approach. Make assumptions explicit. Consolidate proposals when assigned, preserving unresolved objections for a fresh vote.' },
    { name: 'Kepler', description: 'Plans implementation and operational reliability', avatar: 'compass', specialties: ['development', 'operations'], instructions: 'Independently plan implementation, dependencies, data preservation, and failure recovery. Challenge missing requirements. Approve a plan only when it is implementable and verifiable.' },
    { name: 'Forge', description: 'Implements the agreed plan and reviewer corrections', avatar: 'sparkles', specialties: ['development'], instructions: 'Implement only the approved plan. Preserve unrelated work. Run the required checks and report actual evidence. Address every reviewer finding. Request replanning when scope or approach must change.' },
    { name: 'Iris', description: 'Reviews correctness and acceptance evidence', avatar: 'eye', specialties: ['review'], instructions: 'Independently inspect the result against every acceptance criterion and the real completion checks. Report concrete blocking findings with evidence and actionable corrections. Recheck prior findings before approving. Do not edit files.' },
    { name: 'Sentinel', description: 'Reviews usability, regressions, and reliability', avatar: 'eye', specialties: ['review', 'operations'], instructions: 'Independently review usability, regressions, data preservation, and operational impact. Distinguish source inspection from a UI or service you actually exercised. Supply evidence for findings and verify earlier fixes. Do not edit files.' },
] satisfies Array<Pick<AgentDefinition, 'name' | 'description' | 'avatar' | 'specialties' | 'instructions'>>;

export function createStarterTeam(model: ProviderModel, effort: string | null, library: AgentDefinition[], id: () => string, now = Date.now()): AgentDefinition[] {
    if (!model.code || effort && !model.supportedReasoningEfforts?.some(e => e.code === effort)) throw new Error('Choose a model and reasoning effort available on this machine.');
    const names = new Set(library.map(a => a.name.toLowerCase()));
    return roles.map((role, i) => {
        let name = role.name, suffix = 2;
        while (names.has(name.toLowerCase())) name = `${role.name} ${suffix++}`;
        names.add(name.toLowerCase());
        return { ...role, name, id: id(), revision: 1, provider: 'codex', model: model.code, effort,
            permissionMode: i === 2 ? 'default' : 'read-only', documents: [], updatedAt: now };
    });
}

/** Pick a writable executor without assigning the same identity to two roles. */
export function savedWorkflowTeam(library: AgentDefinition[]): AgentDefinition[] | null {
    const agents = [...new Map(library.map(a => [a.id, a])).values()];
    const executor = agents.find(a => a.permissionMode !== 'read-only');
    if (!executor || agents.length < 5) return null;
    const others = agents.filter(a => a.id !== executor.id);
    return [others[0], others[1], executor, others[2], others[3]];
}

export function workflowDraft(team: AgentDefinition[], id: string, now = Date.now()): WorkflowDefinition {
    if (team.length !== 5 || new Set(team.map(a => a.id)).size !== 5) throw new Error('Choose five distinct agents.');
    const snapshots = team.map(a => WorkflowAgentSchema.parse(a));
    return { id, revision: 1, name: '', description: '',
        planners: [
            { agent: snapshots[0], assignment: 'Plan the user experience and acceptance criteria.' },
            { agent: snapshots[1], assignment: 'Plan implementation, dependencies, and risks.' },
        ],
        executor: { agent: snapshots[2], assignment: 'Implement the agreed plan and address findings.' },
        reviewers: [
            { agent: snapshots[3], assignment: 'Review correctness and verify the acceptance criteria.' },
            { agent: snapshots[4], assignment: 'Review interface quality, regressions, and operational impact.' },
        ],
        criteria: '', checks: [{ name: 'Required verification', command: '' }], planningRounds: 3, reviewRounds: 3,
        turnMinutes: 10, maxTurns: 60, approvePlan: false, updatedAt: now };
}

/** Validate both libraries before the single settings update, so failed saves leave no orphan agents. */
export function workflowSave(draft: WorkflowDefinition, candidates: AgentDefinition[], agents: AgentDefinition[], workflows: WorkflowDefinition[]) {
    const workflow = WorkflowDefinitionSchema.parse(draft);
    const slots = workflowSlots(workflow);
    const additions = candidates.flatMap(candidate => {
        const used = slots.find(s => s.agent.id === candidate.id);
        if (!used) return [];
        if (agents.some(a => a.id === candidate.id)) throw new Error('A starter agent changed elsewhere. Reopen workflow setup before saving.');
        return [{ ...candidate, ...used.agent }];
    });
    return { workflow, agentLibrary: AgentLibrarySchema.parse([...agents, ...additions]),
        workflowLibrary: WorkflowLibrarySchema.parse([...workflows.filter(w => w.id !== workflow.id), workflow]) };
}

export function workflowStepError(draft: WorkflowDefinition, step: number): string | null {
    if (step === 0 && !draft.name.trim()) return 'Give this workflow a name before continuing.';
    if (step === 1) {
        const slots = [...draft.planners, draft.executor, ...draft.reviewers];
        if (new Set(slots.map(s => s.agent.id)).size !== slots.length) return 'Choose a different agent for each planning, execution, and review role.';
        if (draft.executor.agent.permissionMode === 'read-only') return 'Choose an executor that allows workspace edits.';
        if (slots.some(s => !s.assignment.trim() || !s.agent.name.trim() || !s.agent.instructions.trim())) return 'Every participant needs a name, instructions, and an assignment.';
    }
    if (step === 2) {
        const parsed = WorkflowDefinitionSchema.safeParse(draft);
        if (!parsed.success) {
            if (!draft.criteria.trim()) return 'Describe what must be true when the workflow finishes.';
            if (draft.checks.some(c => !c.name.trim() || !c.command.trim())) return 'Give every completion check a name and the command to run.';
            return parsed.error.issues[0].message;
        }
    }
    return null;
}

/** A separate settings field prevents old apps stripping steps and running a different workflow. */
export function workflowLibrarySettings(workflows: WorkflowDefinition[]) {
    return { workflowLibrary: workflows.filter(w => !w.steps && !workflowNeedsProviders(w)), workflowLibraryV2: workflows.filter(w => !!w.steps && !workflowNeedsProviders(w)), workflowLibraryV3: workflows.filter(workflowNeedsProviders) };
}
