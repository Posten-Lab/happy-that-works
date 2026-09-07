import { describe, expect, it, vi } from 'vitest';
import type { Metadata } from '@/api/types';
const { getProcessIdentity } = vi.hoisted(() => ({ getProcessIdentity: vi.fn() }));
vi.mock('./checkpoint', () => ({ getProcessIdentity }));
import { mergeRecoveryMetadata, RecoveryLaunchGenerations, trackedProcessIsAlive } from './launchPolicy';

describe('recovery launch policy', () => {
    it('keeps the newest local thread/path and authoritative server title/archive state', () => {
        const local = { path: '/new-worktree', codexThreadId: 'new-thread', currentModelCode: 'chosen', summary: { text: 'old title', updatedAt: 1 } } as Metadata;
        const server = { path: '/old-worktree', codexThreadId: 'old-thread', currentModelCode: 'old-model', lifecycleState: 'archived', summary: { text: 'new title', updatedAt: 2 } } as Metadata;
        expect(mergeRecoveryMetadata(local, server)).toMatchObject({
            path: '/new-worktree', codexThreadId: 'new-thread', currentModelCode: 'chosen', lifecycleState: 'archived', summary: { text: 'new title' },
        });
        expect(mergeRecoveryMetadata({ ...local, codexThreadId: undefined }, server).codexThreadId).toBeUndefined();
    });

    it('refuses a reused or unidentifiable PID instead of permitting an unrelated process kill', () => {
        getProcessIdentity.mockReturnValue('new-birth');
        expect(trackedProcessIsAlive({ pid: 42, processIdentity: 'old-birth' })).toBe(false);
        expect(trackedProcessIsAlive({ pid: 42 })).toBe(false);
        expect(trackedProcessIsAlive({ pid: 42, processIdentity: 'new-birth' })).toBe(true);
    });

    it('invalidates a pending launch across an asynchronous wait while allowing a later explicit resume', async () => {
        const generations = new RecoveryLaunchGenerations();
        const cancelled = generations.capture('session');
        await Promise.resolve();
        generations.cancel('session');
        expect(cancelled()).toBe(true);
        expect(generations.capture('session')()).toBe(false);
        expect(generations.capture('another-session')()).toBe(false);
    });
});
