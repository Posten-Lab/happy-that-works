import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ home: '' }));
vi.mock('node:os', async importOriginal => ({ ...await importOriginal<typeof import('node:os')>(), homedir: () => state.home }));

beforeEach(() => {
    state.home = mkdtempSync(join(tmpdir(), 'talos-identity-'));
    vi.resetModules();
    for (const key of ['TALOS_HOME_DIR', 'TALOS_SERVER_URL', 'TALOS_WEBAPP_URL']) vi.stubEnv(key, '');
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(state.home, { recursive: true, force: true }); });

describe('independent Talos installation', () => {
    it('leaves the earlier installation and its credentials untouched', async () => {
        const old = join(state.home, '.happy');
        mkdirSync(old);
        writeFileSync(join(old, 'access.key'), 'credential-canary');
        writeFileSync(join(old, 'settings.json'), JSON.stringify({ serverUrl: 'https://earlier.example' }));
        vi.stubEnv('HAPPY_HOME_DIR', old);
        const { configuration } = await import('./configuration');
        expect(configuration.talosHomeDir).toBe(join(state.home, '.talos'));
        expect(configuration.serverUrl).toBe('https://api.talosapp.ai');
        expect(readFileSync(join(old, 'access.key'), 'utf8')).toBe('credential-canary');
        expect(JSON.parse(readFileSync(join(old, 'settings.json'), 'utf8')).serverUrl).toBe('https://earlier.example');
    });
    it('honors an explicitly selected home and saved server without guessing a service', async () => {
        const selected = join(state.home, 'selected');
        mkdirSync(selected);
        writeFileSync(join(selected, 'settings.json'), JSON.stringify({ serverUrl: 'https://relay.example', webappUrl: 'https://web.example' }));
        vi.stubEnv('TALOS_HOME_DIR', '~/selected');
        const { configuration } = await import('./configuration');
        expect(configuration.talosHomeDir).toBe(selected);
        expect(configuration.serverUrl).toBe('https://relay.example');
        expect(configuration.webappUrl).toBe('https://web.example');
    });
    it('uses explicit URLs ahead of saved settings', async () => {
        vi.stubEnv('TALOS_SERVER_URL', 'http://127.0.0.1:3465');
        vi.stubEnv('TALOS_WEBAPP_URL', 'http://127.0.0.1:3466');
        const { configuration } = await import('./configuration');
        expect(configuration.serverUrl).toBe('http://127.0.0.1:3465');
        expect(configuration.webappUrl).toBe('http://127.0.0.1:3466');
    });
});
