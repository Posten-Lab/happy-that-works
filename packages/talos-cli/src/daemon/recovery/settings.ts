import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { configuration } from '@/configuration';
import { writePrivateJson } from './checkpoint';

export function isSessionRecoveryEnabled(): boolean {
    if (process.env.TALOS_AUTO_RESUME === '0') return false;
    const path = join(configuration.talosHomeDir, 'recovery-settings.json');
    if (!existsSync(path)) return true;
    try { return JSON.parse(readFileSync(path, 'utf8')).enabled !== false; }
    catch { return false; } // Never resume work against an unreadable saved preference.
}

export function setSessionRecoveryEnabled(enabled: boolean): void {
    mkdirSync(configuration.talosHomeDir, { recursive: true, mode: 0o700 });
    writePrivateJson(join(configuration.talosHomeDir, 'recovery-settings.json'), { enabled });
}
