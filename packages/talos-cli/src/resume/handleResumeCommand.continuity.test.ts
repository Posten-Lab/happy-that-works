import { expect, it, vi } from 'vitest';
import { spawnTalosCLI } from '@/utils/spawnTalosCLI';
import { handleResumeCommand } from './handleResumeCommand';

vi.mock('@/utils/spawnTalosCLI', () => ({ spawnTalosCLI: vi.fn() }));
vi.mock('./resolveTalosSession', () => ({ resolveTalosSession: async () => ({
    id: 'live-session', active: true,
    metadata: { path: '/existing/worktree', flavor: 'codex', codexThreadId: 'live-thread' },
}) }));

it('leaves an active session running and never launches a duplicate provider process', async () => {
    await expect(handleResumeCommand(['live-session'])).rejects.toThrow('still running');
    expect(spawnTalosCLI).not.toHaveBeenCalled();
});
