import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';
import type { Metadata } from '@/api/types';
import { getProcessIdentity } from '@/utils/processIdentity';
export { getProcessIdentity } from '@/utils/processIdentity';

const encryptionSchema = z.object({
    encryptionKey: z.string().min(1), encryptionVariant: z.enum(['legacy', 'dataKey']),
    seq: z.number(), metadataVersion: z.number(), agentStateVersion: z.number(),
});
const checkpointSchema = z.object({
    version: z.literal(1), sessionId: z.string().min(1), serverUrl: z.string(),
    metadata: z.object({ path: z.string(), machineId: z.string().optional() }).passthrough(),
    encryption: encryptionSchema,
    pid: z.number().int().positive(), processIdentity: z.string().nullable(), instanceId: z.string(),
    desiredState: z.enum(['running', 'stopped']), updatedAt: z.number(),
    model: z.string().optional(), permissionMode: z.string().optional(),
});
export type SessionCheckpoint = Omit<z.infer<typeof checkpointSchema>, 'metadata'> & { metadata: Metadata };
export type SessionCheckpointInput = Pick<SessionCheckpoint, 'sessionId' | 'metadata' | 'encryption' | 'model' | 'permissionMode'>;

const instanceId = randomUUID();
let ownProcessIdentity: string | null | undefined;
const directory = () => join(configuration.talosHomeDir, 'session-recovery');
const checkpointPath = (id: string) => join(directory(), `${createHash('sha256').update(id).digest('hex')}.json`);

export function isCheckpointProcessAlive(checkpoint: SessionCheckpoint): boolean {
    if (!checkpoint.processIdentity) return false;
    return getProcessIdentity(checkpoint.pid) === checkpoint.processIdentity;
}

export function writePrivateJson(path: string, value: unknown): void {
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    let fd: number | undefined;
    try {
        fd = openSync(temporary, 'wx', 0o600);
        writeFileSync(fd, JSON.stringify(value));
        fsyncSync(fd);
        closeSync(fd);
        fd = undefined;
        renameSync(temporary, path);
        // fsync(file) does not make the rename durable across power loss.
        // macOS and Linux support syncing the containing directory as well.
        if (process.platform !== 'win32') {
            const directoryFd = openSync(dirname(path), 'r');
            try { fsyncSync(directoryFd); }
            finally { closeSync(directoryFd); }
        }
    } finally {
        if (fd !== undefined) closeSync(fd);
        try { unlinkSync(temporary); } catch { /* Already renamed. */ }
    }
}

export function readSessionCheckpoint(sessionId: string): SessionCheckpoint | null {
    try {
        const parsed = checkpointSchema.safeParse(JSON.parse(readFileSync(checkpointPath(sessionId), 'utf8')));
        if (!parsed.success || parsed.data.sessionId !== sessionId) return null;
        return applyStopIntent(parsed.data as SessionCheckpoint);
    } catch { return null; }
}

function applyStopIntent(checkpoint: SessionCheckpoint): SessionCheckpoint {
    try {
        const intent = JSON.parse(readFileSync(`${checkpointPath(checkpoint.sessionId)}.stopped`, 'utf8'));
        if (!intent || typeof intent.instanceId !== 'string' || !intent.instanceId) {
            return { ...checkpoint, desiredState: 'stopped' };
        }
        if (intent.instanceId === checkpoint.instanceId) return { ...checkpoint, desiredState: 'stopped' };
    } catch (error) {
        // Missing is the only state that proves no stop marker exists. Corrupt
        // or unreadable intent must not silently restart work the user stopped.
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return { ...checkpoint, desiredState: 'stopped' };
    }
    return checkpoint;
}

/** Each session owns its checkpoint. A stopped instance cannot be revived by a late heartbeat. */
export function checkpointSession(input: SessionCheckpointInput): void {
    try {
        mkdirSync(directory(), { recursive: true, mode: 0o700 });
        const previous = readSessionCheckpoint(input.sessionId);
        ownProcessIdentity ??= getProcessIdentity(process.pid);
        const stopped = input.metadata.lifecycleState === 'archived'
            || (previous?.instanceId === instanceId && previous.desiredState === 'stopped');
        writePrivateJson(checkpointPath(input.sessionId), {
            ...input, version: 1, serverUrl: configuration.serverUrl,
            pid: process.pid, processIdentity: ownProcessIdentity, instanceId,
            desiredState: stopped ? 'stopped' : 'running', updatedAt: Date.now(),
        } satisfies SessionCheckpoint);
    } catch (error) {
        logger.debug('[RECOVERY] Could not save session checkpoint', error);
    }
}

/** Durable even while the daemon or network is unavailable. */
export function stopSessionRecovery(sessionId: string): void {
    const previous = readSessionCheckpoint(sessionId);
    if (!previous) return;
    // Separate marker: a heartbeat that already read the checkpoint cannot overwrite this intent.
    writePrivateJson(`${checkpointPath(sessionId)}.stopped`, { instanceId: previous.instanceId });
}

export function readSessionCheckpoints(): SessionCheckpoint[] {
    if (!existsSync(directory())) return [];
    const checkpoints: SessionCheckpoint[] = [];
    for (const file of readdirSync(directory())) {
        if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
        try {
            const parsed = checkpointSchema.safeParse(JSON.parse(readFileSync(join(directory(), file), 'utf8')));
            if (!parsed.success) continue;
            const checkpoint = applyStopIntent(parsed.data as SessionCheckpoint);
            if (checkpoint.desiredState === 'stopped' && Date.now() - checkpoint.updatedAt > 14 * 86400_000) {
                unlinkSync(join(directory(), file));
                try { unlinkSync(join(directory(), `${file}.stopped`)); } catch {}
            } else {
                checkpoints.push(checkpoint);
            }
        } catch { /* A corrupt record must not hide other recoverable sessions. */ }
    }
    return checkpoints;
}
