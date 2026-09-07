import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManagedProviderCallbacks } from './runManagedProvider';

const { createApi, setupOffline, stopSessionRecovery, stopTools } = vi.hoisted(() => ({
    createApi: vi.fn(), setupOffline: vi.fn(), stopSessionRecovery: vi.fn(), stopTools: vi.fn(),
}));
vi.mock('@/claude/utils/startTalosServer', () => ({ startTalosServer: async () => ({ url: 'http://127.0.0.1:1234', stop: stopTools }) }));
vi.mock('@/api/api', () => ({ ApiClient: { create: createApi } }));
vi.mock('@/persistence', () => ({ readSettings: async () => ({ machineId: 'machine-1' }) }));
vi.mock('@/daemon/run', () => ({ initialMachineMetadata: {} }));
vi.mock('@/daemon/controlClient', () => ({ notifyDaemonSessionStarted: async () => ({}) }));
vi.mock('@/daemon/recovery/checkpoint', () => ({ stopSessionRecovery }));
vi.mock('@/utils/setupOfflineReconnection', () => ({ setupOfflineReconnection: setupOffline }));
vi.mock('@/lib', () => ({ logger: { debug: vi.fn() } }));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn(), debugLargeJson: vi.fn() } }));

import { runManagedProvider } from './runManagedProvider';

describe('managed provider recovery lifecycle', () => {
    beforeEach(() => vi.clearAllMocks());

    it.each(['normal', 'SIGINT', 'SIGTERM', 'crash'] as const)('preserves the correct intent after %s', async (ending) => {
        let metadata: Record<string, unknown> = { path: '/tmp', lifecycleState: 'running' };
        const session = {
            sessionId: 'managed-session-1',
            updateMetadata: vi.fn((update: (value: any) => any) => { metadata = update(metadata); }),
            updateAgentState: vi.fn(), on: vi.fn(), onFileEvent: vi.fn(), onUserMessage: vi.fn(),
            rpcHandlerManager: { registerHandler: vi.fn() },
            keepAlive: vi.fn(), sendAgentMessage: vi.fn(), sendSessionEvent: vi.fn(),
            sendSessionDeath: vi.fn(), flush: vi.fn(async () => {}), close: vi.fn(async () => {}),
        };
        createApi.mockResolvedValue({
            getOrCreateMachine: async () => ({}),
            getOrCreateSession: async () => ({
                id: session.sessionId, encryptionKey: new Uint8Array(32), encryptionVariant: 'legacy',
                seq: 0, metadataVersion: 0, agentStateVersion: 0,
            }),
        });
        setupOffline.mockReturnValue({ session });
        let callbacks: ManagedProviderCallbacks;
        const promise = runManagedProvider({
            credentials: {} as any,
            flavor: 'muse', startingMode: 'remote',
            create(next, sessionId, sessionToolsUrl) {
                expect(sessionId).toBe(session.sessionId);
                expect(sessionToolsUrl).toBe('http://127.0.0.1:1234');
                callbacks = next;
                return {
                    async start() {
                        callbacks.metadata({ museSessionId: 'muse-native-1' });
                        callbacks.activity(true);
                        callbacks.activity(false);
                        expect(stopSessionRecovery).not.toHaveBeenCalled();
                        if (ending === 'normal') callbacks.exited();
                        else if (ending === 'crash') callbacks.exited(new Error('provider crashed'));
                        else (process.listeners(ending).at(-1) as () => void)();
                    },
                    async prompt() {}, async switchMode() {}, async cancel() {},
                    async dispose() { callbacks.exited(); },
                };
            },
        });
        if (ending === 'crash') await expect(promise).rejects.toThrow('provider crashed');
        else await promise;
        const expectedStop = ending === 'normal' || ending === 'SIGINT';
        expect(stopSessionRecovery.mock.calls.length > 0).toBe(expectedStop);
        expect(metadata.lifecycleState === 'archived').toBe(expectedStop);
        expect(session.sendSessionDeath).toHaveBeenCalledOnce();
        expect(session.close).toHaveBeenCalledOnce();
        expect(stopTools).toHaveBeenCalledOnce();
    });
});
