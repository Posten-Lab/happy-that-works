import { z } from 'zod';
import type { ProviderModel } from '@/sync/ops';

export const AgentDefinitionSchema = z.object({
    id: z.string().min(1).max(100),
    revision: z.number().int().positive(),
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().min(1).max(300),
    avatar: z.enum(['compass', 'eye', 'brush', 'sparkles']),
    provider: z.enum(['codex', 'claude']),
    model: z.string().min(1).max(200),
    effort: z.string().max(30).nullable(),
    permissionMode: z.enum(['default', 'read-only']),
    instructions: z.string().trim().min(1).max(24000),
    documents: z.array(z.object({ name: z.string().min(1).max(120), content: z.string().max(16000) })).max(5),
    specialties: z.array(z.enum(['development', 'review', 'operations', 'design'])).max(4),
    updatedAt: z.number(),
}).refine(agent => agent.provider === 'codex' || agent.permissionMode === 'default', { message: 'This permission mode is not supported by the selected runtime', path: ['permissionMode'] });
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;
// Leave headroom for UTF-8, encryption/base64, and the rest of account settings.
export const AgentLibrarySchema = z.array(AgentDefinitionSchema).max(100).refine(
    agents => JSON.stringify(agents).length <= 128000,
    'Agent library is too large. Shorten instructions or remove unused agents.',
);
export function agentLibraryEnabled(settings: { experiments?: boolean; expAgentLibrary?: boolean }) {
    return settings.experiments === true && settings.expAgentLibrary === true;
}

/** Fail closed against the selected machine's live catalog, never a merged/fallback catalog. */
export function agentLaunchError(agent: AgentDefinition, models: ProviderModel[] | null): string | null {
    if (agent.provider !== 'codex') return 'This experiment supports Codex. Edit the agent and choose Codex to start a new session.';
    if (!models) return 'Connect an online machine and wait for its model catalog.';
    const model = models.find(m => m.code === agent.model);
    if (!model) return 'This model is unavailable on the selected machine. Edit the agent to choose another model.';
    if (agent.effort && !model.supportedReasoningEfforts?.some(e => e.code === agent.effort)) {
        return 'This reasoning level is unavailable for the selected model. Edit the agent to choose another level.';
    }
    return null;
}
export function agentInstructions(agent: AgentDefinition): string {
    return [
        `You are ${agent.name}. ${agent.description}`,
        agent.instructions,
        ...agent.documents.map(d => `Reference instructions: ${d.name}\n${d.content}`),
    ].join('\n\n');
}
export const agentTemplates = [
    { name: 'Atlas', avatar: 'compass', description: 'Operations and maintenance specialist', specialties: ['operations'], instructions: 'Investigate operational problems using evidence. Explain the cause, propose the smallest reliable fix, and verify service health. Preserve active sessions and user data. Follow the project deployment procedure.' },
    { name: 'Iris', avatar: 'eye', description: 'Reviewer focused on correctness and interface quality', specialties: ['review'], instructions: 'Review changes for correctness, usability, accessibility, and regressions. Report concrete findings with file references and verification steps. Clearly distinguish source inspection from a UI you actually exercised. Do not edit files unless asked.' },
    { name: 'Forma', avatar: 'brush', description: 'Product design and interface specialist', specialties: ['design'], instructions: 'Understand the user task before proposing a design. Develop clear information hierarchy, accessible interactions, and consistent visual language. Explain tradeoffs and provide implementable specifications. Only claim visual validation when you have inspected the actual interface.' },
] satisfies Array<Pick<AgentDefinition, 'name' | 'avatar' | 'description' | 'specialties' | 'instructions'>>;
