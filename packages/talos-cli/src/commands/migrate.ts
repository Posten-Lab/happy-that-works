import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { legacyInstallation } from '@ahmadposten/talos-wire';
import { configuration } from '@/configuration';
import { readLocalTalosAgentCredentials } from '@/resume/localTalosAgentAuth';
import type { Credentials } from '@/persistence';
import { createImportedSessionKeys, importedSessionKeysFile, sessionKeyAccountIdentity } from '@/resume/importedSessionKeys';

type JsonObject = Record<string, unknown>;
type MigrationOptions = {
    sourceHome: string;
    targetHome: string;
    serverUrl?: string;
    webappUrl?: string;
    dryRun?: boolean;
    expectedRelay?: { serverUrl: string; webappUrl: string };
    importSessionKeys?: boolean;
};
type MigrationResult = {
    status: 'migrated' | 'already-migrated' | 'preview';
    machineId: string;
    serverUrl: string;
    webappUrl: string;
    agentImported: boolean;
    sessionKeysImported?: number;
};

const receiptName = 'account-migration.json';
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');

async function optionalFile(path: string): Promise<Buffer | null> {
    try {
        if (!(await lstat(path)).isFile()) throw new Error(`Expected a regular file: ${path}`);
        return await readFile(path);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
    }
}

function object(bytes: Buffer, label: string): JsonObject {
    try {
        const value = JSON.parse(bytes.toString('utf8'));
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch { /* Never include credential contents in an error. */ }
    throw new Error(`Invalid ${label}; no account files were imported.`);
}

function key32(value: unknown): value is string {
    return typeof value === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(value)
        && Buffer.from(value, 'base64').length === 32;
}

function validateCredentials(bytes: Buffer): JsonObject {
    const value = object(bytes, 'account credentials');
    const encryption = value.encryption as JsonObject | undefined;
    if (typeof value.token !== 'string' || !value.token.trim()
        || (value.secret != null && !key32(value.secret))
        || (encryption != null && (!key32(encryption.publicKey) || !key32(encryption.machineKey)))
        || !(key32(value.secret) || (encryption && key32(encryption.publicKey) && key32(encryption.machineKey)))) {
        throw new Error('The source account credentials are incomplete; no account files were imported.');
    }
    return value;
}

function decodedCredentials(value: JsonObject): Credentials {
    const encryption = value.encryption as { publicKey: string; machineKey: string };
    return {
        token: value.token as string,
        encryption: typeof value.secret === 'string'
            ? { type: 'legacy', secret: Buffer.from(value.secret, 'base64') }
            : { type: 'dataKey', publicKey: Buffer.from(encryption.publicKey, 'base64'), machineKey: Buffer.from(encryption.machineKey, 'base64') },
    };
}

async function sessionKeyArchive(source: string, credentials: JsonObject, machineId: string, serverUrl: string): Promise<Buffer | null> {
    const bytes = await optionalFile(join(source, 'sessions.json'));
    if (!bytes) return null;
    let cache: unknown;
    try { cache = JSON.parse(bytes.toString('utf8')); } catch { return null; }
    const archive = createImportedSessionKeys(cache, decodedCredentials(credentials), machineId, serverUrl);
    return archive ? Buffer.from(JSON.stringify(archive, null, 2) + '\n') : null;
}

function mergeSessionKeyIndexes(existing: Buffer | null, incoming: Buffer): Buffer {
    const next = object(incoming, 'incoming session key index');
    if (!existing) return incoming;
    let previous: JsonObject;
    try { previous = object(existing, 'existing session key index'); } catch {
        throw new Error('A different imported session key index already exists; it was preserved.');
    }
    if (previous.version !== 1 || previous.accountIdentity !== next.accountIdentity
        || previous.migrationMachineId !== next.migrationMachineId || previous.sourceServerUrl !== next.sourceServerUrl
        || !previous.sessions || typeof previous.sessions !== 'object' || Array.isArray(previous.sessions)) {
        throw new Error('A different imported session key index already exists; it was preserved.');
    }
    const sessions = new Map<string, { encryptionKey: string; encryptionVariant: string }>();
    for (const entries of [previous.sessions, next.sessions]) {
        for (const [id, raw] of Object.entries(entries as Record<string, JsonObject>)) {
            if (!raw || !key32(raw.encryptionKey) || !['legacy', 'dataKey'].includes(raw.encryptionVariant as string)) {
                throw new Error('The existing session key index is invalid; it was preserved.');
            }
            const key = { encryptionKey: raw.encryptionKey, encryptionVariant: raw.encryptionVariant as string };
            const prior = sessions.get(id);
            if (prior && (prior.encryptionKey !== key.encryptionKey || prior.encryptionVariant !== key.encryptionVariant)) {
                throw new Error('A session already has a different imported encryption key; the entire index was preserved.');
            }
            sessions.set(id, key);
        }
    }
    return Buffer.from(JSON.stringify({ ...next, sessions: Object.fromEntries([...sessions].sort(([a], [b]) => a.localeCompare(b))) }, null, 2) + '\n');
}

async function installAdditionalSessionKeys(target: string, bytes: Buffer, expectedAccess: Buffer, expectedReceipt: Buffer,
    expectedSettings: Buffer, dryRun: boolean): Promise<number> {
    const destination = join(target, importedSessionKeysFile);
    const lockPath = `${destination}.lock`;
    const locked = new Error('Another session key import is in progress. Its lock and index were preserved; retry later.');
    if (dryRun) {
        try { await lstat(lockPath); throw locked; } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        return Object.keys(JSON.parse(mergeSessionKeyIndexes(await optionalFile(destination), bytes).toString()).sessions).length;
    }
    const lock = await open(lockPath, 'wx', 0o600).catch(() => { throw locked; });
    let stage: string | undefined;
    try {
        const existing = await optionalFile(destination);
        const merged = mergeSessionKeyIndexes(existing, bytes);
        const count = Object.keys(JSON.parse(merged.toString()).sessions).length;
        if (existing?.equals(merged)) return count;
        stage = await mkdtemp(join(target, '.session-key-import-'));
        const staged = join(stage, importedSessionKeysFile);
        const handle = await open(staged, 'wx', 0o600);
        try { await handle.writeFile(merged); await handle.sync(); } finally { await handle.close(); }
        if (!(await optionalFile(join(target, 'access.key')))?.equals(expectedAccess)
            || !(await optionalFile(join(target, receiptName)))?.equals(expectedReceipt)
            || !(await optionalFile(join(target, 'settings.json')))?.equals(expectedSettings)) {
            throw new Error('The Talos account or settings changed during session key import; no index was installed.');
        }
        const current = await optionalFile(destination);
        if (existing ? !current?.equals(existing) : current !== null) {
            throw new Error('The session key index changed during import; the current index was preserved.');
        }
        if (existing) await rename(staged, destination);
        else await link(staged, destination);
        return count;
    } finally {
        if (stage) await rm(stage, { recursive: true, force: true });
        await lock.close();
        await unlink(lockPath);
    }
}

function serviceUrl(value: unknown, label: string): string {
    if (typeof value !== 'string') throw new Error(`The source ${label} is invalid.`);
    try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
        return value.replace(/\/+$/, '');
    } catch {
        throw new Error(`The source ${label} must be an HTTP or HTTPS URL without credentials, query, or fragment.`);
    }
}

function contains(parent: string, child: string): boolean {
    const rel = relative(parent, child);
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

async function targetDaemonAbsent(target: string): Promise<void> {
    for (const file of ['daemon.state.json', 'daemon.state.json.lock', 'sessions.json']) {
        try {
            await lstat(join(target, file));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
            throw error;
        }
        throw new Error('This Talos home already has daemon or session state. Use a separate TALOS_HOME_DIR; no process was stopped.');
    }
}

/** Import only account material; running sessions remain owned by their original daemon. */
export async function migrateAccount(options: MigrationOptions): Promise<MigrationResult> {
    const source = await realpath(resolve(options.sourceHome));
    let target = resolve(options.targetHome);
    try { target = await realpath(target); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        target = join(await realpath(dirname(target)), basename(target));
    }
    if (contains(source, target) || contains(target, source)) throw new Error('Source and Talos homes must be separate, non-nested directories.');

    const sourceFiles = new Map<string, Buffer | null>();
    for (const name of ['settings.json', 'access.key', 'agent.key']) sourceFiles.set(name, await optionalFile(join(source, name)));
    const access = sourceFiles.get('access.key');
    if (!access) throw new Error('No account credentials were found in the selected source home.');
    const credentials = validateCredentials(access);
    const settingsBytes = sourceFiles.get('settings.json');
    const settings = settingsBytes ? object(settingsBytes, 'source settings') : {};
    if (typeof settings.schemaVersion === 'number' && settings.schemaVersion > 2) {
        throw new Error('The source settings version is newer than this Talos CLI supports.');
    }
    const existingAccess = await optionalFile(join(target, 'access.key'));
    const existingReceipt = await optionalFile(join(target, receiptName));
    const targetSettingsBytes = options.importSessionKeys && existingAccess && existingReceipt ? await optionalFile(join(target, 'settings.json')) : null;
    const targetSettings = targetSettingsBytes ? object(targetSettingsBytes, 'Talos settings') : {};
    const serverUrl = serviceUrl(options.serverUrl ?? targetSettings.serverUrl ?? settings.serverUrl ?? legacyInstallation.defaultServerUrl, 'server URL');
    const webappUrl = serviceUrl(options.webappUrl ?? targetSettings.webappUrl ?? settings.webappUrl ?? legacyInstallation.defaultWebappUrl, 'web app URL');
    if (options.expectedRelay && (serverUrl !== options.expectedRelay.serverUrl || webappUrl !== options.expectedRelay.webappUrl)) {
        throw new Error('The source relay configuration changed after preview. No account files were imported; run migration again.');
    }
    const agent = sourceFiles.get('agent.key');
    if (agent) {
        const agentData = object(agent, 'agent credentials');
        if (!key32(agentData.secret) || typeof agentData.token !== 'string' || !agentData.token.trim()) {
            throw new Error('The source agent credentials are incomplete.');
        }
        const localAgent = readLocalTalosAgentCredentials(source);
        const encryption = credentials.encryption as JsonObject | undefined;
        const sameAccount = credentials.secret
            ? credentials.secret === agentData.secret
            : localAgent && Buffer.from(localAgent.contentKeyPair.publicKey).toString('base64') === encryption?.publicKey;
        if (!sameAccount) throw new Error('The source CLI and agent credentials belong to different accounts; no files were imported.');
    }

    if (existingAccess || existingReceipt) {
        if (!existingAccess || !existingReceipt || (!options.importSessionKeys && !existingAccess.equals(access))) {
            throw new Error('Talos already has account credentials or a migration record. Use a separate TALOS_HOME_DIR; existing files were preserved.');
        }
        const receipt = object(existingReceipt, 'migration record');
        const files = receipt.files as Record<string, string> | undefined;
        if (!files || receipt.sourceHome !== source || typeof receipt.serverUrl !== 'string' || typeof receipt.webappUrl !== 'string'
            || typeof receipt.machineId !== 'string' || !receipt.machineId
            || (!options.importSessionKeys && (receipt.serverUrl !== serverUrl || receipt.webappUrl !== webappUrl || receipt.machineId === settings.machineId))) {
            throw new Error('The existing Talos migration does not match this source account and relay.');
        }
        if (options.importSessionKeys) {
            if (!targetSettingsBytes || targetSettings.machineId !== receipt.machineId
                || sessionKeyAccountIdentity(decodedCredentials(validateCredentials(existingAccess))) !== sessionKeyAccountIdentity(decodedCredentials(credentials))) {
                throw new Error('The Talos account or machine identity no longer matches this migration; all files were preserved.');
            }
        }
        for (const name of options.importSessionKeys ? [] : ['settings.json', 'access.key', ...(agent ? ['agent.key'] : [])]) {
            const current = await optionalFile(join(target, name));
            if (!current || hash(current) !== files[name]) throw new Error('The migrated Talos account has changed; it was preserved without overwriting.');
        }
        let sessionKeysImported: number | undefined;
        if (options.importSessionKeys) {
            const archive = await sessionKeyArchive(source, credentials, receipt.machineId, receipt.serverUrl as string);
            if (!archive) throw new Error('No valid session keys were found in the source cache.');
            sessionKeysImported = await installAdditionalSessionKeys(target, archive, existingAccess, existingReceipt, targetSettingsBytes!, !!options.dryRun);
        }
        return { status: options.dryRun && options.importSessionKeys ? 'preview' : 'already-migrated', machineId: receipt.machineId, serverUrl, webappUrl, agentImported: !!agent,
            ...(sessionKeysImported === undefined ? {} : { sessionKeysImported }) };
    }
    await targetDaemonAbsent(target);
    for (const name of ['settings.json', 'agent.key', importedSessionKeysFile]) {
        if (await optionalFile(join(target, name))) throw new Error(`Talos already has ${name}. Use a separate TALOS_HOME_DIR; existing files were preserved.`);
    }
    const machineId = randomUUID();
    const archive = await sessionKeyArchive(source, credentials, machineId, serverUrl);
    if (options.importSessionKeys && !archive) throw new Error('No valid session keys were found in the source cache.');
    const result: MigrationResult = { status: options.dryRun ? 'preview' : 'migrated', machineId, serverUrl, webappUrl, agentImported: !!agent };
    if (archive) result.sessionKeysImported = Object.keys(JSON.parse(archive.toString()).sessions).length;
    if (options.dryRun) return result;

    await mkdir(target, { recursive: true, mode: 0o700 });
    // Respect the same settings lock as normal Talos machine registration. Never steal a lock.
    const lockPath = join(target, 'settings.json.lock');
    const lock = await open(lockPath, 'wx', 0o600).catch(() => { throw new Error('Talos settings are in use. Retry after the current command finishes.'); });
    let stage: string | undefined;
    const installed: Array<{ destination: string; staged: string; expectedHash: string }> = [];
    try {
        await targetDaemonAbsent(target);
        stage = await mkdtemp(join(target, '.account-migration-'));
        const importedSettings: JsonObject = {
            schemaVersion: 2,
            onboardingCompleted: settings.onboardingCompleted === true,
            machineId,
            machineIdConfirmedByServer: false,
            serverUrl,
            webappUrl,
        };
        for (const name of ['chromeMode', 'sandboxConfig']) {
            if (settings[name] !== undefined) importedSettings[name] = settings[name];
        }
        const files = new Map<string, Buffer>([
            ['settings.json', Buffer.from(JSON.stringify(importedSettings, null, 2) + '\n')],
            ...(agent ? [['agent.key', agent] as [string, Buffer]] : []),
            ...(archive ? [[importedSessionKeysFile, archive] as [string, Buffer]] : []),
            ['access.key', access],
        ]);
        const receipt = Buffer.from(JSON.stringify({
            version: 1, sourceHome: source, machineId, serverUrl, webappUrl,
            files: Object.fromEntries([...files].map(([name, bytes]) => [name, hash(bytes)])),
        }, null, 2) + '\n');
        files.set(receiptName, receipt);
        for (const [name, bytes] of files) {
            const handle = await open(join(stage, name), 'wx', 0o600);
            try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        }
        // Reject a concurrent source account change; never lock or mutate the original installation.
        for (const [name, before] of sourceFiles) {
            const after = await optionalFile(join(source, name));
            if (before === null ? after !== null : !after?.equals(before)) {
                throw new Error('The source account changed during migration. Retry when its authentication settings are stable.');
            }
        }
        // Exclusive links never overwrite a concurrent login. Credentials are the final commit point.
        for (const name of [...files.keys()].filter(name => name !== 'access.key').concat('access.key')) {
            const staged = join(stage, name);
            const destination = join(target, name);
            await link(staged, destination);
            installed.push({ staged, destination, expectedHash: hash(files.get(name)!) });
        }
        return result;
    } catch (error) {
        for (const { staged, destination, expectedHash } of installed.reverse()) {
            const [original, current] = await Promise.all([lstat(staged), lstat(destination).catch(() => null)]);
            // Do not remove a file that another process replaced after installation.
            const currentBytes = current ? await optionalFile(destination) : null;
            if (currentBytes && current && original.ino === current.ino && original.dev === current.dev && hash(currentBytes) === expectedHash) await unlink(destination);
        }
        throw error;
    } finally {
        if (stage) await rm(stage, { recursive: true, force: true });
        await lock.close();
        await unlink(lockPath);
    }
}

export async function handleMigrateCommand(args: string[]): Promise<void> {
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`\ntalos migrate — import an existing local account into Talos\n\nUsage: talos migrate [--from DIR] [--server-url URL] [--webapp-url URL] [--dry-run] [--import-session-keys]\n\nCopies account credentials into TALOS_HOME_DIR with a separate machine identity.\nExisting sessions keep running on their original daemon and remain in the shared account.\nOriginal files are preserved. Existing Talos accounts are never overwritten.\nUse --import-session-keys to add a historical resume index to an already migrated account.\n`);
        return;
    }
    const options: MigrationOptions = {
        sourceHome: process.env[legacyInstallation.homeEnvironment] || join(homedir(), legacyInstallation.homeDirectory),
        targetHome: configuration.talosHomeDir,
        serverUrl: process.env[legacyInstallation.serverEnvironment],
        webappUrl: process.env[legacyInstallation.webappEnvironment],
    };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--dry-run') { options.dryRun = true; continue; }
        if (arg === '--import-session-keys') { options.importSessionKeys = true; continue; }
        if (!['--from', '--server-url', '--webapp-url'].includes(arg) || !args[i + 1] || args[i + 1].startsWith('--')) {
            throw new Error(`Invalid migration argument: ${arg}. Run talos migrate --help.`);
        }
        const value = args[++i];
        if (arg === '--from') options.sourceHome = value;
        if (arg === '--server-url') options.serverUrl = value;
        if (arg === '--webapp-url') options.webappUrl = value;
    }
    options.sourceHome = options.sourceHome.replace(/^~(?=\/|$)/, homedir());
    // Explicit Talos environment overrides must not silently send imported keys to another relay.
    const preview = await migrateAccount({ ...options, dryRun: true });
    for (const [name, value] of [['TALOS_SERVER_URL', preview.serverUrl], ['TALOS_WEBAPP_URL', preview.webappUrl]]) {
        if (process.env[name] && serviceUrl(process.env[name], name) !== value) {
            throw new Error(`${name} conflicts with the imported account configuration. Unset it or use a matching migration URL option.`);
        }
    }
    const result = options.dryRun ? preview : await migrateAccount({
        ...options,
        expectedRelay: { serverUrl: preview.serverUrl, webappUrl: preview.webappUrl },
    });
    console.log(result.status === 'preview' ? 'Account migration is ready.'
        : result.status === 'already-migrated' ? 'This account is already available in Talos.' : 'Account imported into Talos.');
    console.log(`Relay: ${result.serverUrl}`);
    if (result.sessionKeysImported !== undefined) console.log(`Historical session keys available: ${result.sessionKeysImported}`);
    console.log('Existing sessions keep running. Talos uses a separate machine identity for new sessions.');
    console.log('To view existing sessions in the Talos app, link or restore the same account on this relay.');
}
