import { describe, expect, it, vi } from 'vitest';
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';

const { stopSessionRecovery } = vi.hoisted(() => ({ stopSessionRecovery: vi.fn() }));
vi.mock('@/daemon/recovery/checkpoint', () => ({ stopSessionRecovery }));
vi.mock('@/lib', () => ({ logger: { debug: vi.fn() } }));

import { registerKillSessionHandler } from './registerKillSessionHandler';

describe('kill session recovery intent', () => {
    it('persists an explicit stop before asynchronous cleanup and immediately acknowledges the request', async () => {
        const registerHandler = vi.fn();
        const cleanup = vi.fn(() => {
            expect(stopSessionRecovery).toHaveBeenCalledWith('session-1');
            return new Promise<void>(() => {});
        });
        registerKillSessionHandler({ registerHandler } as unknown as RpcHandlerManager, cleanup, 'session-1');
        const handler = registerHandler.mock.calls[0][1];
        await expect(handler()).resolves.toMatchObject({ success: true });
        expect(cleanup).toHaveBeenCalledOnce();
    });
});
