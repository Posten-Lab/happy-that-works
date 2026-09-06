import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { encrypt, decrypt } from '@/api/encryption';
import { readLocalTalosAgentCredentials } from '@/resume/localTalosAgentAuth';
import { migrateAccount } from './migrate';
import { importedSessionKeysFile } from '@/resume/importedSessionKeys';

vi.mock('@/configuration', () => ({ configuration: { talosHomeDir: '/unused-migration-test-home' } }));
vi.mock('node:fs/promises', async importOriginal => {
    const original = await importOriginal<typeof import('node:fs/promises')>();
    return { ...original, link: vi.fn(original.link) };
});

const secret = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
const credentialBytes = Buffer.from(JSON.stringify({ token: 'synthetic-account-token', secret: secret.toString('base64') }, null, 4) + '\n');
const agentBytes = Buffer.from(JSON.stringify({ token: 'synthetic-agent-token', secret: secret.toString('base64') }) + '\n');
let root: string;
let source: string;
let target: string;

async function sourceSnapshot() {
    return Object.fromEntries(await Promise.all((await readdir(source)).sort().map(async file => [file, (await readFile(join(source, file))).toString('base64')])));
}

beforeEach(async () => {
    const original = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(link).mockReset().mockImplementation(original.link);
    root = await mkdtemp(join(tmpdir(), 'talos-account-import-test-'));
    source = join(root, 'earlier');
    target = join(root, 'talos');
    await mkdir(source);
    await mkdir(target);
    await writeFile(join(source, 'access.key'), credentialBytes);
    await writeFile(join(source, 'agent.key'), agentBytes);
    await writeFile(join(source, 'settings.json'), JSON.stringify({
        schemaVersion: 2, machineId: 'running-original-machine', machineIdConfirmedByServer: true,
        onboardingCompleted: true, serverUrl: 'https://existing-relay.example', webappUrl: 'https://existing-web.example',
        chromeMode: true, sandboxConfig: { enabled: true },
    }));
    await writeFile(join(source, 'daemon.state.json'), JSON.stringify({ pid: process.pid, httpPort: 31415 }));
    await writeFile(join(source, 'daemon.state.json.lock'), String(process.pid));
    await writeFile(join(source, 'sessions.json'), JSON.stringify({ sessions: { 'live-session': { active: true } } }));
});
afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
});

describe('explicit account migration', () => {
    const cacheWithKeys = { sessions: { 'existing-session': {
        encryptionKey: Buffer.alloc(32, 6).toString('base64'), encryptionVariant: 'dataKey',
        metadata: { hostPid: 555, machineId: 'original-machine', path: '/original/path' }, savedAt: 1,
    } } };

    it('automatically preserves a separate key index without adopting original sessions', async () => {
        await writeFile(join(source, 'sessions.json'), JSON.stringify(cacheWithKeys));
        const before = await sourceSnapshot();
        const result = await migrateAccount({ sourceHome: source, targetHome: target });
        expect(result.sessionKeysImported).toBe(1);
        const archive = JSON.parse(await readFile(join(target, importedSessionKeysFile), 'utf8'));
        expect(archive.sessions).toEqual({ 'existing-session': {
            encryptionKey: Buffer.alloc(32, 6).toString('base64'), encryptionVariant: 'dataKey',
        } });
        expect(archive.migrationMachineId).toBe(result.machineId);
        expect(await sourceSnapshot()).toEqual(before);
        await expect(lstat(join(target, 'sessions.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('adds keys to a previously migrated account without rewriting credentials, settings, or receipt', async () => {
        await migrateAccount({ sourceHome: source, targetHome: target });
        await writeFile(join(source, 'sessions.json'), JSON.stringify(cacheWithKeys));
        const files = ['access.key', 'agent.key', 'settings.json', 'account-migration.json'];
        const before = await Promise.all(files.map(name => readFile(join(target, name))));
        const sourceBefore = await sourceSnapshot();
        const preview = await migrateAccount({ sourceHome: source, targetHome: target, importSessionKeys: true, dryRun: true });
        expect(preview.sessionKeysImported).toBe(1);
        await expect(lstat(join(target, importedSessionKeysFile))).rejects.toMatchObject({ code: 'ENOENT' });
        const result = await migrateAccount({ sourceHome: source, targetHome: target, importSessionKeys: true });
        expect(result.sessionKeysImported).toBe(1);
        expect(await Promise.all(files.map(name => readFile(join(target, name))))).toEqual(before);
        expect(await sourceSnapshot()).toEqual(sourceBefore);
    });

    it('preserves a conflicting key index, including during preview', async () => {
        await migrateAccount({ sourceHome: source, targetHome: target });
        await writeFile(join(source, 'sessions.json'), JSON.stringify(cacheWithKeys));
        await writeFile(join(target, importedSessionKeysFile), 'existing-index-canary');
        await expect(migrateAccount({ sourceHome: source, targetHome: target, importSessionKeys: true, dryRun: true })).rejects.toThrow('different imported session key index');
        expect(await readFile(join(target, importedSessionKeysFile), 'utf8')).toBe('existing-index-canary');
    });

    it('allows confirmed registration, token renewal, and relay preferences to evolve without rewriting them', async () => {
        await writeFile(join(source, 'sessions.json'), JSON.stringify(cacheWithKeys));
        await migrateAccount({ sourceHome: source, targetHome: target });
        const settings = JSON.parse(await readFile(join(target, 'settings.json'), 'utf8'));
        settings.machineIdConfirmedByServer = true;
        settings.serverUrl = 'https://verified-new-alias.example';
        settings.webappUrl = 'https://new-web.example';
        settings.chromeMode = false;
        await writeFile(join(target, 'settings.json'), JSON.stringify(settings));
        const targetCredentials = JSON.parse(credentialBytes.toString());
        targetCredentials.token = 'renewed-same-account-token';
        await writeFile(join(target, 'access.key'), JSON.stringify(targetCredentials));
        const names = ['settings.json', 'access.key', 'account-migration.json'];
        const before = await Promise.all(names.map(name => readFile(join(target, name))));
        const result = await migrateAccount({ sourceHome: source, targetHome: target, importSessionKeys: true });
        expect(result).toMatchObject({ serverUrl: settings.serverUrl, webappUrl: settings.webappUrl, sessionKeysImported: 1 });
        expect(await Promise.all(names.map(name => readFile(join(target, name))))).toEqual(before);
    });

    it('adds new session IDs and retains old keys even after they disappear from the source cache', async () => {
        await writeFile(join(source, 'sessions.json'), JSON.stringify(cacheWithKeys));
        await migrateAccount({ sourceHome: source, targetHome: target });
        const original = JSON.parse(await readFile(join(target, importedSessionKeysFile), 'utf8'));
        await writeFile(join(source, 'sessions.json'), JSON.stringify({ sessions: {
            'new-session': { encryptionKey: Buffer.alloc(32, 7).toString('base64'), encryptionVariant: 'dataKey' },
        } }));
        const sourceBefore = await sourceSnapshot();
        const result = await migrateAccount({ sourceHome: source, targetHome: target, importSessionKeys: true });
        const merged = JSON.parse(await readFile(join(target, importedSessionKeysFile), 'utf8'));
        expect(result.sessionKeysImported).toBe(2);
        expect(merged.sessions['existing-session']).toEqual(original.sessions['existing-session']);
        expect(merged.sessions['new-session'].encryptionKey).toBe(Buffer.alloc(32, 7).toString('base64'));
        expect(await sourceSnapshot()).toEqual(sourceBefore);
        if (process.platform !== 'win32') expect((await lstat(join(target, importedSessionKeysFile))).mode & 0o777).toBe(0o600);
    });

    it('refuses a changed key for an existing session without adding any other keys', async () => {
        await writeFile(join(source, 'sessions.json'), JSON.stringify(cacheWithKeys));
        await migrateAccount({ sourceHome: source, targetHome: target });
        const before = await readFile(join(target, importedSessionKeysFile));
        await writeFile(join(source, 'sessions.json'), JSON.stringify({ sessions: {
            'existing-session': { encryptionKey: Buffer.alloc(32, 8).toString('base64'), encryptionVariant: 'dataKey' },
            'new-session': { encryptionKey: Buffer.alloc(32, 9).toString('base64'), encryptionVariant: 'dataKey' },
        } }));
        await expect(migrateAccount({ sourceHome: source, targetHome: target, importSessionKeys: true })).rejects.toThrow('different imported encryption key');
        expect(await readFile(join(target, importedSessionKeysFile))).toEqual(before);
        await expect(lstat(join(target, `${importedSessionKeysFile}.lock`))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('refuses a concurrent import lock without deleting it or changing the index', async () => {
        await writeFile(join(source, 'sessions.json'), JSON.stringify(cacheWithKeys));
        await migrateAccount({ sourceHome: source, targetHome: target });
        const before = await readFile(join(target, importedSessionKeysFile));
        const lockFile = join(target, `${importedSessionKeysFile}.lock`);
        await writeFile(lockFile, 'other-import-canary');
        await expect(migrateAccount({ sourceHome: source, targetHome: target, importSessionKeys: true })).rejects.toThrow('Another session key import');
        expect(await readFile(lockFile, 'utf8')).toBe('other-import-canary');
        expect(await readFile(join(target, importedSessionKeysFile))).toEqual(before);
    });

    it('preserves source bytes and credentials while assigning a separate unconfirmed machine identity', async () => {
        const before = await sourceSnapshot();
        const kill = vi.spyOn(process, 'kill');
        const result = await migrateAccount({ sourceHome: source, targetHome: target });
        expect(result.status).toBe('migrated');
        expect(await sourceSnapshot()).toEqual(before);
        expect(await readFile(join(target, 'access.key'))).toEqual(credentialBytes);
        expect(await readFile(join(target, 'agent.key'))).toEqual(agentBytes);
        const settings = JSON.parse(await readFile(join(target, 'settings.json'), 'utf8'));
        expect(settings).toMatchObject({
            machineId: result.machineId, machineIdConfirmedByServer: false,
            serverUrl: 'https://existing-relay.example', webappUrl: 'https://existing-web.example',
            chromeMode: true, sandboxConfig: { enabled: true },
        });
        expect(result.machineId).not.toBe('running-original-machine');
        for (const name of ['daemon.state.json', 'daemon.state.json.lock', 'sessions.json']) {
            expect(await readFile(join(source, name))).toBeDefined();
            await expect(lstat(join(target, name))).rejects.toMatchObject({ code: 'ENOENT' });
        }
        expect(kill).not.toHaveBeenCalled();
        if (process.platform !== 'win32') {
            expect((await lstat(join(target, 'access.key'))).mode & 0o777).toBe(0o600);
            expect((await lstat(join(target, 'agent.key'))).mode & 0o777).toBe(0o600);
        }
    });

    it('keeps the original key able to decrypt existing session ciphertext', async () => {
        const message = { role: 'assistant', content: 'Existing session continues on the same account' };
        const ciphertext = encrypt(secret, 'legacy', message);
        await migrateAccount({ sourceHome: source, targetHome: target });
        const imported = JSON.parse(await readFile(join(target, 'access.key'), 'utf8'));
        expect(decrypt(Buffer.from(imported.secret, 'base64'), 'legacy', ciphertext)).toEqual(message);
        expect(imported.token).toBe('synthetic-account-token');
    });

    it('imports per-machine encryption credentials without rotating account or machine keys', async () => {
        const publicKey = Buffer.from(readLocalTalosAgentCredentials(source)!.contentKeyPair.publicKey).toString('base64');
        const machineKey = Buffer.alloc(32, 23);
        const bytes = Buffer.from(JSON.stringify({ token: 'existing-token', encryption: { publicKey, machineKey: machineKey.toString('base64') } }));
        await writeFile(join(source, 'access.key'), bytes);
        const ciphertext = encrypt(machineKey, 'dataKey', { sessionId: 'existing-session' });
        await migrateAccount({ sourceHome: source, targetHome: target });
        expect(await readFile(join(target, 'access.key'))).toEqual(bytes);
        const imported = JSON.parse(await readFile(join(target, 'access.key'), 'utf8'));
        expect(decrypt(Buffer.from(imported.encryption.machineKey, 'base64'), 'dataKey', ciphertext)).toEqual({ sessionId: 'existing-session' });
    });

    it('refuses a conflicting Talos account without changing either installation', async () => {
        const existing = Buffer.from('another-account-canary');
        await writeFile(join(target, 'access.key'), existing);
        const before = await sourceSnapshot();
        await expect(migrateAccount({ sourceHome: source, targetHome: target })).rejects.toThrow('already has account credentials');
        expect(await readFile(join(target, 'access.key'))).toEqual(existing);
        expect(await readdir(target)).toEqual(['access.key']);
        expect(await sourceSnapshot()).toEqual(before);
    });

    it('fails closed on an interrupted import without removing its partial files', async () => {
        await writeFile(join(target, 'account-migration.json'), '{"version":1}');
        await writeFile(join(target, 'settings.json.lock'), 'interrupted-import-canary');
        const before = await sourceSnapshot();
        await expect(migrateAccount({ sourceHome: source, targetHome: target })).rejects.toThrow('migration record');
        expect(await readdir(target)).toEqual(['account-migration.json', 'settings.json.lock']);
        expect(await readFile(join(target, 'settings.json.lock'), 'utf8')).toBe('interrupted-import-canary');
        expect(await sourceSnapshot()).toEqual(before);
    });

    it.each(['daemon.state.json', 'daemon.state.json.lock', 'sessions.json'])('refuses an occupied Talos home containing %s', async name => {
        await writeFile(join(target, name), 'existing-state');
        await expect(migrateAccount({ sourceHome: source, targetHome: target })).rejects.toThrow('already has daemon or session state');
        expect(await readdir(target)).toEqual([name]);
    });

    it('rolls back every installed account file when the final credential commit fails', async () => {
        const original = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
        const before = await sourceSnapshot();
        vi.mocked(link).mockImplementation(async (from, to) => {
            if (basename(String(to)) === 'access.key') throw new Error('synthetic final commit failure');
            return original.link(from, to);
        });
        await expect(migrateAccount({ sourceHome: source, targetHome: target })).rejects.toThrow('synthetic final commit failure');
        expect(await readdir(target)).toEqual([]);
        expect(await sourceSnapshot()).toEqual(before);
    });

    it('never overwrites a concurrent login that wins the final credential commit', async () => {
        const original = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
        vi.mocked(link).mockImplementation(async (from, to) => {
            if (basename(String(to)) === 'access.key') await writeFile(to, 'concurrent-account-canary');
            return original.link(from, to);
        });
        await expect(migrateAccount({ sourceHome: source, targetHome: target })).rejects.toMatchObject({ code: 'EEXIST' });
        expect(await readFile(join(target, 'access.key'), 'utf8')).toBe('concurrent-account-canary');
        expect(await readdir(target)).toEqual(['access.key']);
    });

    it('supports a repeat invocation without rotating machine identity or rewriting any files', async () => {
        const first = await migrateAccount({ sourceHome: source, targetHome: target });
        const before = await readFile(join(target, 'settings.json'));
        const result = await migrateAccount({ sourceHome: source, targetHome: target });
        expect(result).toEqual({ ...first, status: 'already-migrated' });
        expect(await readFile(join(target, 'settings.json'))).toEqual(before);
    });

    it('previews migration without creating account files', async () => {
        const before = await sourceSnapshot();
        expect((await migrateAccount({ sourceHome: source, targetHome: target, dryRun: true })).status).toBe('preview');
        expect(await readdir(target)).toEqual([]);
        expect(await sourceSnapshot()).toEqual(before);
    });

    it.each(['serverUrl', 'webappUrl'])('refuses a source %s change between preview and import', async field => {
        const preview = await migrateAccount({ sourceHome: source, targetHome: target, dryRun: true });
        const settings = JSON.parse(await readFile(join(source, 'settings.json'), 'utf8'));
        settings[field] = 'https://changed-relay.example';
        await writeFile(join(source, 'settings.json'), JSON.stringify(settings));
        const before = await sourceSnapshot();
        await expect(migrateAccount({
            sourceHome: source, targetHome: target,
            expectedRelay: { serverUrl: preview.serverUrl, webappUrl: preview.webappUrl },
        })).rejects.toThrow('relay configuration changed after preview');
        expect(await readdir(target)).toEqual([]);
        expect(await sourceSnapshot()).toEqual(before);
    });

    it('refuses to combine source CLI and agent accounts with different secrets', async () => {
        await writeFile(join(source, 'agent.key'), JSON.stringify({ token: 'other', secret: Buffer.alloc(32, 9).toString('base64') }));
        await expect(migrateAccount({ sourceHome: source, targetHome: target })).rejects.toThrow('different accounts');
        expect(await readdir(target)).toEqual([]);
    });

    it('rejects malformed keys even when another credential format is present', async () => {
        await writeFile(join(source, 'access.key'), JSON.stringify({
            token: 'synthetic-token', secret: 'invalid-secret',
            encryption: { publicKey: secret.toString('base64'), machineKey: secret.toString('base64') },
        }));
        await expect(migrateAccount({ sourceHome: source, targetHome: target })).rejects.toThrow('credentials are incomplete');
        expect(await readdir(target)).toEqual([]);
    });

    it('refuses an overlapping home or a symlinked credential file', async () => {
        await expect(migrateAccount({ sourceHome: source, targetHome: source })).rejects.toThrow('separate, non-nested');
        await rm(join(source, 'access.key'));
        await writeFile(join(root, 'linked-account'), credentialBytes);
        await symlink(join(root, 'linked-account'), join(source, 'access.key'));
        await expect(migrateAccount({ sourceHome: source, targetHome: target })).rejects.toThrow('regular file');
        expect(await readdir(target)).toEqual([]);
    });
});
