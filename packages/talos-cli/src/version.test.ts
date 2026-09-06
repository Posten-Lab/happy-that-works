import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import packageJson from '../package.json';

const homes: string[] = [];
afterEach(() => {
    for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe('version checks', () => {
    it.each([['--version'], ['-v'], ['claude', '--version']])('reports the installed version without authentication for %s', (...args) => {
        const home = mkdtempSync(join(tmpdir(), 'talos-version-test-'));
        homes.push(home);
        const result = spawnSync(process.execPath, [
            '--no-warnings', '--no-deprecation', resolve('bin/talos.mjs'), ...args,
        ], {
            encoding: 'utf8', timeout: 10000,
            env: {
                ...process.env, TALOS_HOME_DIR: home, TALOS_VARIANT: 'stable',
                TALOS_SERVER_URL: 'http://127.0.0.1:1', TALOS_WEBAPP_URL: 'http://127.0.0.1:1',
            },
        });
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(result.stdout.trim()).toBe(`talos version: ${packageJson.version}`);
        expect(result.stderr).toBe('');
        for (const file of ['access.key', 'settings.json', 'daemon.state.json', 'sessions.json']) {
            expect(existsSync(join(home, file)), file).toBe(false);
        }
    });
});
