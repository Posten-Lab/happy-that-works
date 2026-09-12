import { describe, expect, it } from 'vitest';
import { AgentDefinitionSchema, AgentLibrarySchema, agentInstructions, agentLaunchError, agentLibraryEnabled, type AgentDefinition } from './agentDefinition';
import { settingsParse, settingsParsePending } from '@/sync/settings';
import { resolveMessageModeMeta } from '@/sync/messageMeta';

const agent: AgentDefinition = { id: 'iris', revision: 1, name: 'Iris', avatar: 'eye', description: 'Reviewer', provider: 'codex', model: 'test-model', effort: 'high', permissionMode: 'read-only', instructions: 'Review without editing.', documents: [{ name: 'review.md', content: 'Report evidence.' }], specialties: ['review'], updatedAt: 1 };
const catalog = [{ code: 'test-model', value: 'Test', supportedReasoningEfforts: [{ code: 'high', value: 'High' }] }];
describe('experimental agent definitions', () => {
    it('requires both opt-in switches and defaults off for old accounts', () => {
        expect(agentLibraryEnabled(settingsParse({}))).toBe(false);
        expect(agentLibraryEnabled({ experiments: true })).toBe(false);
        expect(agentLibraryEnabled({ expAgentLibrary: true })).toBe(false);
        expect(agentLibraryEnabled({ experiments: true, expAgentLibrary: true })).toBe(true);
    });
    it('preserves definitions with the flag off and never injects pending library defaults', () => {
        expect(settingsParse({ agentLibrary: [agent], experiments: false }).agentLibrary).toEqual([agent]);
        expect(settingsParsePending({ experiments: true })).toEqual({ experiments: true });
    });
    it('rejects oversized instructions and unsupported runtime', () => {
        expect(AgentDefinitionSchema.safeParse({ ...agent, instructions: 'a'.repeat(24001) }).success).toBe(false);
        expect(AgentDefinitionSchema.safeParse({ ...agent, provider: 'unknown' }).success).toBe(false);
        expect(AgentDefinitionSchema.safeParse({ ...agent, provider: 'claude' }).success).toBe(false);
    });
    it('requires live model and effort support instead of silently falling back', () => {
        expect(agentLaunchError(agent, null)).toBeTruthy();
        expect(agentLaunchError(agent, [])).toBeTruthy();
        expect(agentLaunchError({ ...agent, effort: 'ultra' }, catalog)).toBeTruthy();
        expect(agentLaunchError(agent, catalog)).toBeNull();
        expect(agentLaunchError({ ...agent, effort: null }, catalog)).toBeNull();
    });
    it('rejects a library that would overflow account settings transport', () => {
        const large = Array.from({ length: 6 }, (_, i) => ({ ...agent, id: String(i), instructions: 'a'.repeat(24000) }));
        expect(AgentLibrarySchema.safeParse(large).success).toBe(false);
    });
    it('preserves earlier definitions but blocks new non-Codex launches', () => {
        const earlier = { ...agent, provider: 'claude' as const, permissionMode: 'default' as const };
        expect(settingsParse({ agentLibrary: [earlier] }).agentLibrary).toEqual([earlier]);
        expect(agentLaunchError(earlier, catalog)).toContain('supports Codex');
    });
    it('takes a deep snapshot and includes attached instructions', () => {
        const source = structuredClone(agent);
        const snapshot = AgentDefinitionSchema.parse(source);
        source.documents[0].content = 'Changed';
        expect(agentInstructions(snapshot)).toContain('Report evidence.');
        expect(agentInstructions(snapshot)).not.toContain('Changed');
    });
    it('uses session snapshots across devices instead of changed global defaults', () => {
        const session = { metadata: { path: '/tmp', host: 'test', flavor: 'codex', agentProfile: { ...agent, effort: null } }, permissionMode: null, modelMode: null, effortLevel: null };
        const settings = { agentDefaultOverrides: { codex: { permissionMode: 'yolo', modelMode: 'different', effortLevel: 'ultra' } } };
        expect(resolveMessageModeMeta(session, settings)).toEqual({ permissionMode: 'read-only', model: 'test-model', effort: null });
        expect(resolveMessageModeMeta({ ...session, modelMode: 'explicit-change' }, settings).model).toBe('explicit-change');
    });
});
