import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    sessionBash: vi.fn(),
    applyGitStatus: vi.fn(),
    sessions: {} as Record<string, { metadata: { machineId: string; path: string; workflowManaged?: boolean } }>,
}));

vi.mock('./ops', () => ({ sessionBash: mocks.sessionBash }));
vi.mock('./storage', () => ({
    storage: { getState: () => ({ sessions: mocks.sessions, applyGitStatus: mocks.applyGitStatus }) },
}));

import { GitStatusSync } from './gitStatusSync';

describe('Git status polling session lifetime', () => {
    let statusSync: GitStatusSync;

    beforeEach(() => {
        statusSync = new GitStatusSync();
        mocks.sessions = {};
        mocks.applyGitStatus.mockReset();
        mocks.sessionBash.mockReset();
        mocks.sessionBash.mockImplementation(async (_id, { command }) => ({
            success: true,
            exitCode: 0,
            stdout: command.includes('status --porcelain') ? '# branch.head main\n? new-file.txt\n' : '',
        }));
    });

    afterEach(() => {
        Object.keys(mocks.sessions).forEach(id => statusSync.stop(id));
        vi.useRealTimers();
    });

    it('does not start or invalidate background Git RPCs from managed participant transcripts', async () => {
        mocks.sessions.participant = { metadata: { machineId: 'mac', path: '/project', workflowManaged: true } };
        vi.useFakeTimers();

        await statusSync.getSync('participant').invalidateAndAwait();
        statusSync.invalidate('participant');
        await vi.advanceTimersByTimeAsync(350);

        expect(mocks.sessionBash).not.toHaveBeenCalled();
        expect(mocks.applyGitStatus).not.toHaveBeenCalled();
    });

    it('preserves ordinary session polling and cached status for the same project', async () => {
        mocks.sessions.participant = { metadata: { machineId: 'mac', path: '/project', workflowManaged: true } };
        mocks.sessions.ordinary = { metadata: { machineId: 'mac', path: '/project' } };

        await statusSync.getSync('participant').invalidateAndAwait();
        await statusSync.getSync('ordinary').invalidateAndAwait();
        statusSync.clearForSession('participant');

        expect(mocks.sessionBash).toHaveBeenCalledTimes(4);
        expect(mocks.sessionBash.mock.calls.every(([id]) => id === 'ordinary')).toBe(true);
        expect(mocks.applyGitStatus).toHaveBeenCalledExactlyOnceWith('mac:/project', expect.objectContaining({
            branch: 'main', untrackedCount: 1, isDirty: true,
        }));
    });

    it('rechecks managed metadata before an already registered poll issues an RPC', async () => {
        mocks.sessions.participant = { metadata: { machineId: 'mac', path: '/project' } };
        const previousSync = statusSync.getSync('participant');
        mocks.sessions.participant.metadata.workflowManaged = true;

        await previousSync.invalidateAndAwait();
        expect(mocks.sessionBash).not.toHaveBeenCalled();
        expect(mocks.applyGitStatus).not.toHaveBeenCalled();
    });

    it('removes a stale participant registration and its pending invalidation when metadata arrives', async () => {
        mocks.sessions.participant = { metadata: { machineId: 'mac', path: '/project' } };
        statusSync.getSync('participant');
        vi.useFakeTimers();
        statusSync.invalidate('participant');
        mocks.sessions.participant.metadata.workflowManaged = true;

        await statusSync.getSync('participant').invalidateAndAwait();
        await vi.advanceTimersByTimeAsync(350);
        expect(mocks.sessionBash).not.toHaveBeenCalled();

        mocks.sessions.ordinary = { metadata: { machineId: 'mac', path: '/project' } };
        await statusSync.getSync('ordinary').invalidateAndAwait();
        expect(mocks.sessionBash).toHaveBeenCalledTimes(4);
        expect(mocks.sessionBash.mock.calls.every(([id]) => id === 'ordinary')).toBe(true);
    });
});
