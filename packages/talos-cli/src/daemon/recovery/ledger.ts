import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { writePrivateJson } from './checkpoint';
import type { RecoveryLedgerEntry } from './coordinator';

const ledgerSchema = z.array(z.object({
    sessionId: z.string(), status: z.enum(['pending', 'restoring', 'restored', 'failed']),
    attempts: z.number().int().nonnegative(), updatedAt: z.number(), error: z.string().optional(),
    retryAt: z.number().optional(), instanceId: z.string().optional(), healthySince: z.number().optional(),
}));

/** Stores only retry status, scoped to this account's machine and server. */
export function recoveryLedger(talosHome: string, serverUrl: string, machineId: string) {
    const scope = createHash('sha256').update(`${serverUrl}\n${machineId}`).digest('hex');
    const directory = join(talosHome, 'recovery-status');
    const path = join(directory, `${scope}.json`);
    return {
        load(): RecoveryLedgerEntry[] {
            try { return ledgerSchema.parse(JSON.parse(readFileSync(path, 'utf8'))); }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
                throw new Error('Saved session recovery status could not be read. Automatic retries are paused.');
            }
        },
        save(entries: RecoveryLedgerEntry[]) {
            mkdirSync(directory, { recursive: true, mode: 0o700 });
            writePrivateJson(path, entries);
        },
    };
}
