import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { configuration } from '@/configuration';
import type { Credentials } from '@/persistence';
import { runManagedProvider } from '@/agent/runManagedProvider';
import { MuseSession } from './MuseSession';

export function runMuse(opts: { credentials: Credentials; startedBy?: 'daemon' | 'terminal';
    startingMode?: 'local' | 'remote'; resumeId?: string; nativeArgs?: string[] }) {
    return runManagedProvider({ ...opts, flavor: 'muse',
        startingMode: opts.startingMode ?? (opts.startedBy === 'daemon' ? 'remote' : 'local'),
        create: (callbacks, talosSessionId) => {
            const directory = join(configuration.talosHomeDir, 'muse');
            const journal = join(directory, `${createHash('sha256').update(talosSessionId).digest('hex')}.commands`);
            return new MuseSession(process.cwd(), callbacks, opts.nativeArgs, {
                load() {
                    try { return readFileSync(journal, 'utf8').split('\n').filter(Boolean); }
                    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
                },
                record(id) {
                    mkdirSync(directory, { recursive: true, mode: 0o700 });
                    appendFileSync(journal, `${id}\n`, { mode: 0o600 });
                },
            });
        },
    });
}
