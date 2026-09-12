import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { WorkflowRunSchema, type WorkflowRun } from '@ahmadposten/talos-wire';
import { decrypt, encrypt } from '@/api/encryption';

/** Account/server/machine-scoped, authenticated encryption and atomic private writes. */
export class WorkflowStore {
    readonly directory: string;
    constructor(home: string, scope: string, private readonly key: Uint8Array) {
        this.directory = join(home, 'workflows', createHash('sha256').update(scope).digest('hex'));
        mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    }
    save(run: WorkflowRun) {
        WorkflowRunSchema.parse(run);
        const target = join(this.directory, `${run.id}.bin`), tmp = `${target}.tmp`;
        const data = encrypt(this.key, 'dataKey', run);
        writeFileSync(tmp, data, { mode: 0o600 });
        const fd = openSync(tmp, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
        renameSync(tmp, target);
        // Windows cannot open directories through fs.open; the file was flushed before atomic rename.
        if (process.platform !== 'win32') {
            const parent = openSync(this.directory, 'r'); try { fsyncSync(parent); } finally { closeSync(parent); }
        }
    }
    load(): WorkflowRun[] {
        return readdirSync(this.directory).filter(f => f.endsWith('.bin')).map(f => {
            const data = readFileSync(join(this.directory, f));
            return WorkflowRunSchema.parse(decrypt(this.key, 'dataKey', data));
        });
    }
}
