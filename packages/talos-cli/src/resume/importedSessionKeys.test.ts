import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Credentials } from '@/persistence';
import { createImportedSessionKeys, importedSessionKeysFile, readImportedSessionKeys } from './importedSessionKeys';

const credentials: Credentials = { token: 'fixture-token', encryption: { type: 'dataKey', publicKey: new Uint8Array(32).fill(1), machineKey: new Uint8Array(32).fill(2) } };
const sessionKey = Buffer.alloc(32, 3).toString('base64');
let home: string;
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), 'talos-imported-session-keys-')); });
afterEach(async () => { await rm(home, { recursive: true, force: true }); });

async function archiveFixture() {
    const archive = createImportedSessionKeys({ sessions: { 'session-1': {
        encryptionKey: sessionKey, encryptionVariant: 'dataKey', pid: 555, metadata: { hostPid: 555, path: '/private/path' },
    }, invalid: { encryptionKey: 'short', encryptionVariant: 'dataKey' } } }, credentials, 'new-machine', 'https://original.example')!;
    await writeFile(join(home, importedSessionKeysFile), JSON.stringify(archive));
    await writeFile(join(home, 'account-migration.json'), JSON.stringify({ machineId: 'new-machine', serverUrl: 'https://original.example' }));
    return archive;
}

describe('private imported session key index', () => {
    it('copies only valid keys and omits process ownership and cached metadata', async () => {
        const archive = await archiveFixture();
        expect(archive.sessions).toEqual({ 'session-1': { encryptionKey: sessionKey, encryptionVariant: 'dataKey' } });
        expect(await readImportedSessionKeys(home, credentials)).toEqual(archive);
        expect(await readFile(join(home, importedSessionKeysFile), 'utf8')).not.toContain('hostPid');
    });

    it('rejects another account even when the migration receipt matches', async () => {
        await archiveFixture();
        const other: Credentials = { token: 'other-token', encryption: { type: 'dataKey', publicKey: new Uint8Array(32).fill(8), machineKey: new Uint8Array(32).fill(9) } };
        await expect(readImportedSessionKeys(home, other)).rejects.toThrow('does not belong');
    });

    it('accepts token rotation and a different machine key for the same account public key', async () => {
        const archive = await archiveFixture();
        const same: Credentials = { token: 'refreshed', encryption: { type: 'dataKey', publicKey: new Uint8Array(32).fill(1), machineKey: new Uint8Array(32).fill(7) } };
        expect(await readImportedSessionKeys(home, same)).toEqual(archive);
    });

    it('rejects an archive transplanted from a different migration receipt', async () => {
        await archiveFixture();
        await writeFile(join(home, 'account-migration.json'), JSON.stringify({ machineId: 'different-machine', serverUrl: 'https://original.example' }));
        await expect(readImportedSessionKeys(home, credentials)).rejects.toThrow('does not belong');
    });
});
