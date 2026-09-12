import { beforeEach, describe, expect, it, vi } from 'vitest';

const { machineRPC, refreshSessions } = vi.hoisted(() => ({
    machineRPC: vi.fn(),
    refreshSessions: vi.fn(),
}));

vi.mock('./apiSocket', () => ({
    apiSocket: { machineRPC },
}));

vi.mock('./sync', () => ({
    sync: { refreshSessions },
}));

describe('codex fork ops', () => {
    beforeEach(() => {
        machineRPC.mockReset();
        refreshSessions.mockReset();
    });

    it('forks a full Codex thread and spawns a Codex session resumed to the new thread', async () => {
        machineRPC.mockImplementation(async (_machineId: string, method: string) => {
            if (method === 'codex-fork-thread') {
                return { type: 'success', newCodexThreadId: 'thread-forked' };
            }
            if (method === 'spawn-happy-session') {
                return { type: 'success', sessionId: 'talos-forked' };
            }
            throw new Error(`unexpected method ${method}`);
        });

        const { forkAndSpawn } = await import('./ops');
        const result = await forkAndSpawn({
            kind: 'codex',
            sessionId: 'talos-source',
            machineId: 'machine-1',
            directory: '/tmp/project',
            codexThreadId: 'thread-source',
        });

        expect(result).toEqual({ type: 'success', sessionId: 'talos-forked' });
        expect(machineRPC).toHaveBeenNthCalledWith(
            1,
            'machine-1',
            'codex-fork-thread',
            { directory: '/tmp/project', codexThreadId: 'thread-source' },
        );
        expect(machineRPC).toHaveBeenNthCalledWith(
            2,
            'machine-1',
            'spawn-happy-session',
            expect.objectContaining({
                agent: 'codex',
                directory: '/tmp/project',
                resumeCodexThreadId: 'thread-forked',
                parentSessionId: 'talos-source',
            }),
        );
        expect(refreshSessions).toHaveBeenCalledTimes(1);
    });

    it('duplicates a Codex thread from a selected user item before spawning', async () => {
        machineRPC.mockImplementation(async (_machineId: string, method: string) => {
            if (method === 'codex-duplicate-thread') {
                return { type: 'success', newCodexThreadId: 'thread-cut' };
            }
            if (method === 'spawn-happy-session') {
                return { type: 'success', sessionId: 'talos-cut' };
            }
            throw new Error(`unexpected method ${method}`);
        });

        const { forkAndSpawn } = await import('./ops');
        const result = await forkAndSpawn({
            kind: 'codex',
            sessionId: 'talos-source',
            machineId: 'machine-1',
            directory: '/tmp/project',
            codexThreadId: 'thread-source',
        }, {
            cutAfterItemId: 'user-item-2',
            forkedFromMessageId: 'message-2',
        });

        expect(result).toEqual({ type: 'success', sessionId: 'talos-cut' });
        expect(machineRPC).toHaveBeenNthCalledWith(
            1,
            'machine-1',
            'codex-duplicate-thread',
            { directory: '/tmp/project', codexThreadId: 'thread-source', cutAfterItemId: 'user-item-2' },
        );
        expect(machineRPC).toHaveBeenNthCalledWith(
            2,
            'machine-1',
            'spawn-happy-session',
            expect.objectContaining({
                agent: 'codex',
                resumeCodexThreadId: 'thread-cut',
                forkedFromMessageId: 'message-2',
            }),
        );
    });

    it('queries the selected machine for its live Codex models', async () => {
        machineRPC.mockResolvedValue({
            type: 'success',
            models: [{
                code: 'gpt-6-astra',
                value: 'GPT-6-Astra',
                isDefault: true,
                supportedReasoningEfforts: [
                    { code: 'max', value: 'max' },
                    { code: 'ultra', value: 'ultra' },
                ],
            }],
        });

        const { codexListModels } = await import('./ops');
        await expect(codexListModels('machine-1')).resolves.toEqual({
            type: 'success',
            models: [{
                code: 'gpt-6-astra',
                value: 'GPT-6-Astra',
                isDefault: true,
                supportedReasoningEfforts: [
                    { code: 'max', value: 'max' },
                    { code: 'ultra', value: 'ultra' },
                ],
            }],
        });
        expect(machineRPC).toHaveBeenCalledWith('machine-1', 'codex-list-models', {});
    });

    it('falls back cleanly when live Codex model discovery is unavailable', async () => {
        machineRPC.mockRejectedValue(new Error('older daemon'));

        const { codexListModels } = await import('./ops');
        await expect(codexListModels('machine-1')).resolves.toEqual({
            type: 'error',
            errorMessage: 'older daemon',
        });
    });
});

it('queries Claude models on the selected machine and normalizes encrypted handler errors', async () => {
    const { claudeListModels } = await import('./ops');
    machineRPC.mockResolvedValueOnce({ type: 'success', models: [{ code: 'future', value: 'Future' }] });
    expect(await claudeListModels('dell')).toEqual({ type: 'success', models: [{ code: 'future', value: 'Future' }] });
    expect(machineRPC).toHaveBeenLastCalledWith('dell', 'claude-list-models', {});
    machineRPC.mockResolvedValueOnce({ error: 'Claude unavailable' });
    expect(await claudeListModels('dell')).toEqual({ type: 'error', errorMessage: 'Claude unavailable' });
    machineRPC.mockRejectedValueOnce(new Error('RPC method not available'));
    expect(await claudeListModels('old-daemon')).toEqual({ type: 'error', errorMessage: 'RPC method not available' });
});


it('resumes a restored account session against an earlier daemon', async () => {
    machineRPC.mockImplementation(async (_machineId: string, method: string) => {
        if (method !== 'resume-happy-session') throw new Error('RPC method not available');
        return { type: 'success', sessionId: 'existing-session' };
    });
    const { machineResumeSession } = await import('./ops');
    await expect(machineResumeSession({ machineId: 'earlier-machine', sessionId: 'existing-session' }))
        .resolves.toEqual({ type: 'success', sessionId: 'existing-session' });
    expect(machineRPC).toHaveBeenLastCalledWith('earlier-machine', 'resume-happy-session', {
        sessionId: 'existing-session', model: undefined, permissionMode: undefined,
    });
});

it('normalizes an encrypted daemon resume error instead of silently treating it as an unknown result', async () => {
    machineRPC.mockResolvedValueOnce({ error: 'Session recovery data is unavailable on this machine.' });
    const { machineResumeSession } = await import('./ops');
    await expect(machineResumeSession({ machineId: 'machine', sessionId: 'archive' })).resolves.toEqual({
        type: 'error', errorMessage: 'Session recovery data is unavailable on this machine.',
    });
});
