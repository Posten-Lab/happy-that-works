import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Credentials } from '@/persistence';

export const importedSessionKeysFile = 'imported-session-keys.json';
type SessionKey = { encryptionKey: string; encryptionVariant: 'legacy' | 'dataKey' };
export type ImportedSessionKeys = {
    version: 1;
    accountIdentity: string;
    sourceServerUrl: string;
    migrationMachineId: string;
    sessions: Record<string, SessionKey>;
};

export function sessionKeyAccountIdentity(credentials: Credentials): string {
    const encryption = credentials.encryption;
    return createHash('sha256').update(`talos-session-key-account-v1:${encryption.type}:`)
        .update(encryption.type === 'legacy' ? encryption.secret : encryption.publicKey).digest('hex');
}

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validKey(value: unknown): value is SessionKey {
    if (!record(value)) return false;
    return (value.encryptionVariant === 'legacy' || value.encryptionVariant === 'dataKey')
        && typeof value.encryptionKey === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(value.encryptionKey)
        && Buffer.from(value.encryptionKey, 'base64').length === 32;
}

/** Select cryptographic material only. This file never establishes process or daemon ownership. */
export function createImportedSessionKeys(cache: unknown, credentials: Credentials, migrationMachineId: string, sourceServerUrl: string): ImportedSessionKeys | null {
    if (!record(cache) || !record(cache.sessions)) return null;
    const entries = Object.entries(cache.sessions).filter(([id, value]) => /^[A-Za-z0-9_-]{1,200}$/.test(id) && validKey(value))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, value]) => {
            const key = value as SessionKey;
            return [id, { encryptionKey: key.encryptionKey, encryptionVariant: key.encryptionVariant }] as const;
        });
    if (!entries.length) return null;
    return {
        version: 1, accountIdentity: sessionKeyAccountIdentity(credentials), sourceServerUrl, migrationMachineId,
        sessions: Object.fromEntries(entries),
    };
}

export async function readImportedSessionKeys(home: string, credentials: Credentials): Promise<ImportedSessionKeys | null> {
    const file = join(home, importedSessionKeysFile);
    try {
        if (!(await lstat(file)).isFile()) throw new Error('The imported session key index must be a regular file.');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
    }
    let archive: unknown;
    let receipt: unknown;
    try {
        archive = JSON.parse(await readFile(file, 'utf8'));
        receipt = JSON.parse(await readFile(join(home, 'account-migration.json'), 'utf8'));
    } catch {
        throw new Error('The imported session key index or migration record is invalid.');
    }
    if (!record(archive) || archive.version !== 1 || !record(archive.sessions) || !record(receipt)
        || typeof receipt.machineId !== 'string' || !receipt.machineId
        || typeof receipt.serverUrl !== 'string' || !receipt.serverUrl
        || archive.accountIdentity !== sessionKeyAccountIdentity(credentials)
        || archive.migrationMachineId !== receipt.machineId || archive.sourceServerUrl !== receipt.serverUrl) {
        throw new Error('The imported session key index does not belong to this migrated account.');
    }
    if (Object.values(archive.sessions).some(value => !validKey(value))) throw new Error('The imported session key index contains invalid keys.');
    return archive as ImportedSessionKeys;
}
