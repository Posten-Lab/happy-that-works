import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { WorkflowRunSchema, workflowNeedsProviders, type WorkflowRun } from '@ahmadposten/talos-wire';
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
        const v3 = join(this.directory, 'v3');
        const upgraded = existsSync(join(v3, `${run.id}.bin`));
        if (workflowNeedsProviders(run.definition) && !upgraded) {
            // Retire the old coordinator's checkpoint before promotion. A crash must
            // never let an older CLI resume the pre-replacement agent configuration.
            for (const oldDirectory of [this.directory, join(this.directory, 'v2')]) {
                const oldPath = join(oldDirectory, `${run.id}.bin`);
                if (!existsSync(oldPath)) continue;
                const previous = WorkflowRunSchema.parse(decrypt(this.key, 'dataKey', readFileSync(oldPath)));
                if (workflowNeedsProviders(previous.definition)) throw new Error('Unexpected provider checkpoint in a legacy directory.');
                previous.status = 'cancelled';
                previous.reason = 'This run was upgraded to multi-provider workflows. Continue using the updated Talos CLI; this legacy checkpoint cannot resume.';
                this.save(previous);
            }
        }
        // Once upgraded, retain the versioned location even if replacements are all Codex.
        const directory = upgraded || workflowNeedsProviders(run.definition) ? v3 : run.definition.steps ? join(this.directory, 'v2') : this.directory;
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        const target = join(directory, `${run.id}.bin`), tmp = `${target}.tmp`;
        const data = encrypt(this.key, 'dataKey', run);
        writeFileSync(tmp, data, { mode: 0o600 });
        const fd = openSync(tmp, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
        renameSync(tmp, target);
        // Windows cannot open directories through fs.open; the file was flushed before atomic rename.
        if (process.platform !== 'win32') {
            const parent = openSync(directory, 'r'); try { fsyncSync(parent); } finally { closeSync(parent); }
        }
    }
    load(): WorkflowRun[] {
        const runs = [this.directory, join(this.directory, 'v2'), join(this.directory, 'v3')].filter(existsSync).flatMap(directory => readdirSync(directory).filter(f => f.endsWith('.bin')).map(f => {
            const data = readFileSync(join(directory, f));
            return WorkflowRunSchema.parse(decrypt(this.key, 'dataKey', data));
        }));
        return [...new Map(runs.map(run => [run.id, run])).values()];
    }
}
