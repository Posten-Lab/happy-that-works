import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import axios from 'axios';
import type { Credentials } from '@/persistence';
import { encodeBase64, encrypt } from '@/api/encryption';
import { createImportedSessionKeys, importedSessionKeysFile } from './importedSessionKeys';
import { resolveTalosSession } from './resolveTalosSession';

const state = vi.hoisted(() => ({ home: '', credentials: null as Credentials | null }));
vi.mock('@/configuration', () => ({ configuration: { get talosHomeDir() { return state.home; }, serverUrl: 'https://verified-alias.example', currentCliVersion: 'test' } }));
vi.mock('@/persistence', () => ({ readCredentials: async () => state.credentials }));
vi.mock('./localTalosAgentAuth', () => ({ readLocalTalosAgentCredentials: () => null, getLocalTalosAgentCredentialPath: () => '/fixture/agent.key' }));
vi.mock('axios', async importOriginal => ({ ...await importOriginal<typeof import('axios')>(), default: { get: vi.fn() } }));

const key = Buffer.alloc(32, 4);
const metadata = { path: '/current/worktree', flavor: 'codex', codexThreadId: 'latest-provider-thread', machineId: 'original-machine' };
const session = { id: 'existing-session', active: false, metadata: encodeBase64(encrypt(key, 'dataKey', metadata)), dataEncryptionKey: 'opaque-server-wrapped-key', seq: 25, metadataVersion: 4, agentStateVersion: 0, agentState: null };
beforeEach(async () => {
    state.home = await mkdtemp(join(tmpdir(), 'talos-imported-resolve-'));
    state.credentials = { token: 'same-account-token', encryption: { type: 'dataKey', publicKey: Buffer.alloc(32, 1), machineKey: Buffer.alloc(32, 2) } };
    const archive = createImportedSessionKeys({ sessions: { [session.id]: { encryptionKey: key.toString('base64'), encryptionVariant: 'dataKey', metadata: { path: '/stale/cache/path' } } } }, state.credentials, 'new-machine', 'https://original.example');
    await writeFile(join(state.home, importedSessionKeysFile), JSON.stringify(archive));
    await writeFile(join(state.home, 'account-migration.json'), JSON.stringify({ machineId: 'new-machine', serverUrl: 'https://original.example' }));
    vi.mocked(axios.get).mockReset().mockResolvedValue({ data: { sessions: [session] } });
});
afterEach(async () => { await rm(state.home, { recursive: true, force: true }); });

describe('historical resume without a master account secret', () => {
    it('uses the current token and alias to decrypt latest metadata with an imported key', async () => {
        expect(await resolveTalosSession('existing')).toEqual({ id: session.id, active: false, metadata });
        expect(axios.get).toHaveBeenCalledWith('https://verified-alias.example/v1/sessions', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer same-account-token' }) }));
    });

    it('refuses an archived ID absent from the authenticated account response', async () => {
        vi.mocked(axios.get).mockResolvedValue({ data: { sessions: [{ ...session, id: 'foreign-session' }] } });
        await expect(resolveTalosSession(session.id)).rejects.toThrow('No Talos session found');
    });

    it('refuses a key that cannot authenticate current server metadata', async () => {
        vi.mocked(axios.get).mockResolvedValue({ data: { sessions: [{ ...session, metadata: encodeBase64(encrypt(Buffer.alloc(32, 9), 'dataKey', metadata)) }] } });
        await expect(resolveTalosSession(session.id)).rejects.toThrow('Failed to decrypt metadata');
    });

    it('reports current active state without invoking any resume operation', async () => {
        vi.mocked(axios.get).mockResolvedValue({ data: { sessions: [{ ...session, active: true }] } });
        expect((await resolveTalosSession(session.id)).active).toBe(true);
        expect(axios.get).toHaveBeenCalledTimes(1);
    });
});
