import { spawnMspConnection, type SpawnedMspConnection } from '@muse-code/sdk';
import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { logger } from '@/ui/logger';
import { object, text, type JsonObject } from './museProtocol';

export function museExecutable(): string {
    const override = process.env.MUSE_CLI;
    if (override) {
        if (!isAbsolute(override)) throw new Error('MUSE_CLI must be an absolute path to the Muse executable');
        accessSync(override, constants.X_OK);
        return override;
    }
    const installed = join(homedir(), '.local', 'bin', 'muse');
    try { accessSync(installed, constants.X_OK); return installed; } catch { return 'muse'; }
}

export async function connectMuse(cwd: string, onNotification: (method: string, params: JsonObject) => void = () => {}): Promise<SpawnedMspConnection> {
    const handshake = spawnMspConnection({ command: museExecutable(), args: ['serve'], cwd,
        shutdownTimeoutMs: 10_000, onStderr: chunk => logger.debug(`[Muse] ${chunk}`) });
    handshake.onNotification(n => onNotification(n.method, object(n.params)));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const connection = await Promise.race([
            handshake.initialize({ clientInfo: { name: 'talos', version: '1' } }),
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Muse did not initialize within 20 seconds')), 20_000); }),
        ]);
        if (connection.initializeResult.sessionDurability !== 'durable') throw new Error('Talos requires durable Muse sessions for terminal handoff');
        if (connection.fingerprintWarning) logger.debug('[Muse] Host schema differs from SDK; using advertised protocol capabilities');
        return connection;
    } catch (error) {
        await handshake.close();
        throw new Error(`Cannot start Muse Code. Install it from https://dev.meta.ai and run muse login. ${String(error)}`);
    } finally { clearTimeout(timer); }
}

export async function discoverMuseModels(cwd: string) {
    const host = await connectMuse(cwd);
    try {
        const response = await host.connection.request('model/list', {});
        return (Array.isArray(response.models) ? response.models : []).map(object).filter(m => text(m.modelId)).map(m => ({
            code: text(m.modelId), value: text(m.displayLabel) || text(m.modelId), description: text(m.description), isDefault: m.isDefault === true,
        }));
    } finally { await host.close(); }
}
