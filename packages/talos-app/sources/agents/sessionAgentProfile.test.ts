import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agentTemplates, type AgentDefinition } from './agentDefinition';
const mocks = vi.hoisted(() => ({ request: vi.fn(), ack: vi.fn(), refresh: vi.fn(), encrypt: vi.fn(), decrypt: vi.fn(), getEncryption: vi.fn() }));
vi.mock('@/sync/apiSocket', () => ({ apiSocket: { request: mocks.request, emitWithAck: mocks.ack } }));
vi.mock('@/sync/sync', () => ({ sync: { encryption: { getSessionEncryption: mocks.getEncryption }, refreshSessions: mocks.refresh } }));
import { saveSessionAgentProfile } from './sessionAgentProfile';
const profile: AgentDefinition = { ...agentTemplates[1], id: 'iris', revision: 1, provider: 'codex', model: 'model', effort: 'high', permissionMode: 'read-only', documents: [], updatedAt: 1 };
beforeEach(() => {
    vi.resetAllMocks();
    mocks.getEncryption.mockReturnValue({ encryptRaw: mocks.encrypt, decryptRaw: mocks.decrypt });
    mocks.request.mockResolvedValue({ ok: true, json: async () => ({ session: { metadata: 'encrypted-one', metadataVersion: 1 } }) });
    mocks.decrypt.mockResolvedValue({ path: '/project', providerSpecific: 'preserve-me' });
    mocks.encrypt.mockResolvedValue('encrypted-profile');
});
describe('persist agent launch snapshot', () => {
    it('retries conflicts using the latest raw metadata without dropping provider fields', async () => {
        mocks.ack.mockResolvedValueOnce({ result: 'version-mismatch', metadata: 'encrypted-two', version: 2 }).mockResolvedValueOnce({ result: 'success' });
        mocks.decrypt.mockResolvedValueOnce({ path: '/project', providerSpecific: 'original' }).mockResolvedValueOnce({ path: '/project', providerSpecific: 'new-value' });
        await saveSessionAgentProfile('session', profile);
        expect(mocks.encrypt).toHaveBeenLastCalledWith({ path: '/project', providerSpecific: 'new-value', agentProfile: profile, name: 'Iris' });
        expect(mocks.ack.mock.calls[1][1].expectedVersion).toBe(2);
        expect(mocks.refresh).toHaveBeenCalledOnce();
    });
    it('fails before any write when encryption is unavailable', async () => {
        mocks.getEncryption.mockReturnValue(null);
        await expect(saveSessionAgentProfile('session', profile)).rejects.toThrow('encryption');
        expect(mocks.ack).not.toHaveBeenCalled();
    });
    it('fails after bounded conflict retries instead of launching without instructions', async () => {
        mocks.ack.mockResolvedValue({ result: 'version-mismatch', metadata: 'encrypted-two', version: 2 });
        await expect(saveSessionAgentProfile('session', profile)).rejects.toThrow('kept changing');
        expect(mocks.ack).toHaveBeenCalledTimes(4);
        expect(mocks.refresh).not.toHaveBeenCalled();
    });
});
