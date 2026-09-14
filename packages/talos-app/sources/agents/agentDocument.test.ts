import { describe, expect, it, vi } from 'vitest';
import { readAgentDocument } from './agentDocument';
import { AgentDefinitionSchema, agentInstructions } from './agentDefinition';
import { WorkflowAgentSchema } from '@ahmadposten/talos-wire';

describe('agent reference files', () => {
    it('preserves a Markdown file beyond the old 16K limit through both schemas and the prompt', async () => {
        const content = '# Reference\n' + 'x'.repeat(20000) + '\nREFERENCE_END';
        const document = await readAgentDocument({ name: 'reference.md' }, async () => content);
        const agent = AgentDefinitionSchema.parse({ id: 'test', revision: 1, name: 'Test', description: 'Test agent', avatar: 'eye', provider: 'codex', model: 'test', effort: null, permissionMode: 'yolo', instructions: 'Read references.', documents: [document], specialties: [], updatedAt: 1 });
        expect(WorkflowAgentSchema.parse(agent).documents[0].content).toBe(content);
        expect(agentInstructions(agent)).toContain(content);
    });
    it('accepts exactly 64,000 characters including multibyte text', async () => {
        const content = '界'.repeat(64000);
        expect(await readAgentDocument({ name: 'reference.md', size: 192000 }, async () => content)).toEqual({ name: 'reference.md', content });
    });
    it('rejects excess characters without truncating', async () => {
        await expect(readAgentDocument({ name: 'reference.md' }, async () => 'x'.repeat(64001))).rejects.toThrow('64,000 characters');
    });
    it('rejects oversized files and unsupported filenames before reading', async () => {
        const read = vi.fn(async () => 'text');
        await expect(readAgentDocument({ name: 'reference.md', size: 256001 }, read)).rejects.toThrow('too large');
        await expect(readAgentDocument({ name: 'reference.pdf' }, read)).rejects.toThrow('Markdown');
        await expect(readAgentDocument({ name: 'x'.repeat(121) + '.md' }, read)).rejects.toThrow('filename');
        expect(read).not.toHaveBeenCalled();
    });
    it('propagates read failures instead of treating the file as attached', async () => {
        await expect(readAgentDocument({ name: 'reference.md' }, async () => { throw new Error('Read failed'); })).rejects.toThrow('Read failed');
    });
});
