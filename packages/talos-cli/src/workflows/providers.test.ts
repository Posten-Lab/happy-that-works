import { MuseMessageMapper } from '@/muse/museProtocol';
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeWorkflowOptions, workflowWritePath, workflowDecision, museWorkflowAnswer } from './providers';

describe('provider workflow boundaries', () => {
    it('keeps reviewers without shell, write, MCP or delegation tools; confines executor writes', async () => {
        const root = mkdtempSync(join(tmpdir(), 'workflow-permissions-'));
        try {
            const directory = join(root, 'worktree'); mkdirSync(directory);
            const read = claudeWorkflowOptions(directory, false), write = claudeWorkflowOptions(directory, true);
            expect(read.tools).toEqual(['Read', 'Glob', 'Grep']);
            expect(read.strictMcpConfig).toBe(true); expect(read.mcpServers).toEqual({}); expect(read.settingSources).toEqual([]);
            expect(write.sandbox).toMatchObject({ enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, filesystem: { allowWrite: [directory] } });
            const permission = async (options: typeof read, tool: string, input: Record<string, unknown>) => options.canUseTool!(tool, input, {} as any);
            expect((await permission(read, 'Write', { file_path: join(directory, 'result.txt') }))?.behavior).toBe('deny');
            expect((await permission(read, 'Bash', { command: 'touch result.txt' }))?.behavior).toBe('deny');
            expect((await permission(write, 'Write', { file_path: join(directory, 'result.txt') }))?.behavior).toBe('allow');
            expect((await permission(write, 'Write', { file_path: join(root, 'outside.txt') }))?.behavior).toBe('deny');
            expect((await permission(write, 'Bash', { dangerouslyDisableSandbox: true }))?.behavior).toBe('deny');
            expect((await permission(write, 'Agent', {}))?.behavior).toBe('deny');
            if (process.platform !== 'win32') {
                symlinkSync(root, join(directory, 'escape'));
                expect(workflowWritePath(directory, 'escape/secret.txt')).toBe(false);
                expect(workflowWritePath(directory, 'escape/new/secret.txt')).toBe(false);
            }
        } finally { rmSync(root, { recursive: true, force: true }); }
    });
    it('does not replace a structured Muse answer with a trailing native reminder', () => {
        const mapper = new MuseMessageMapper();
        const answer = JSON.stringify({ decision: 'approve', summary: 'Verified', document: '', findings: [] });
        const messages = [
            ...mapper.map({ itemId: 'answer', kind: 'agentMessage', status: 'completed', text: answer }),
            ...mapper.map({ itemId: 'reminder', kind: 'reminderChunk', status: 'completed', fallbackText: 'Keep the task focused' }),
        ];
        expect(messages.map(museWorkflowAnswer).filter(x => x !== undefined)).toEqual([answer]);
    });
    it('rejects inconsistent approval and malformed provider results', () => {
        expect(() => workflowDecision({ decision: 'approve', summary: 'Ready', document: '', findings: [{ title: 'Failure', evidence: 'Check failed', correction: 'Fix it', blocking: true }] })).toThrow();
        expect(() => workflowDecision(undefined)).toThrow();
    });
});
