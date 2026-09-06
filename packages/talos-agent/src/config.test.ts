import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { loadConfig } from './config';

const state = vi.hoisted(() => ({ home: '' }));
vi.mock('node:os', async importOriginal => ({ ...await importOriginal<typeof import('node:os')>(), homedir: () => state.home }));

describe('config', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        state.home = mkdtempSync(join(tmpdir(), 'talos-agent-config-test-'));
        delete process.env.TALOS_SERVER_URL;
        delete process.env.TALOS_HOME_DIR;
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        rmSync(state.home, { recursive: true, force: true });
    });

    describe('defaults', () => {
        it('uses default server URL', () => {
            const config = loadConfig();
            expect(config.serverUrl).toBe('https://api.talosapp.ai');
        });

        it('uses default home directory', () => {
            const config = loadConfig();
            expect(config.homeDir).toBe(join(homedir(), '.talos'));
        });

        it('derives credential path from home directory', () => {
            const config = loadConfig();
            expect(config.credentialPath).toBe(join(homedir(), '.talos', 'agent.key'));
        });
    });

    describe('env var overrides', () => {
        it('overrides server URL with TALOS_SERVER_URL', () => {
            process.env.TALOS_SERVER_URL = 'https://custom-server.example.com';
            const config = loadConfig();
            expect(config.serverUrl).toBe('https://custom-server.example.com');
        });

        it('overrides home directory with TALOS_HOME_DIR', () => {
            process.env.TALOS_HOME_DIR = '/tmp/custom-talos';
            const config = loadConfig();
            expect(config.homeDir).toBe('/tmp/custom-talos');
        });

        it('derives credential path from overridden home directory', () => {
            process.env.TALOS_HOME_DIR = '/tmp/custom-talos';
            const config = loadConfig();
            expect(config.credentialPath).toBe('/tmp/custom-talos/agent.key');
        });

        it('allows both overrides simultaneously', () => {
            process.env.TALOS_SERVER_URL = 'https://other.example.com';
            process.env.TALOS_HOME_DIR = '/opt/talos';
            const config = loadConfig();
            expect(config.serverUrl).toBe('https://other.example.com');
            expect(config.homeDir).toBe('/opt/talos');
            expect(config.credentialPath).toBe('/opt/talos/agent.key');
        });
    });

    describe('saved account relay', () => {
        it('uses the imported relay without rewriting account settings', () => {
            const selected = join(state.home, 'migrated');
            mkdirSync(selected);
            const settings = JSON.stringify({ machineId: 'separate-machine', serverUrl: 'https://existing-relay.example/' });
            writeFileSync(join(selected, 'settings.json'), settings);
            process.env.TALOS_HOME_DIR = '~/migrated';
            expect(loadConfig()).toEqual({
                serverUrl: 'https://existing-relay.example', homeDir: selected, credentialPath: join(selected, 'agent.key'),
            });
            expect(readFileSync(join(selected, 'settings.json'), 'utf8')).toBe(settings);
        });

        it('uses an explicit relay ahead of the saved migration relay', () => {
            const selected = join(state.home, '.talos');
            mkdirSync(selected);
            writeFileSync(join(selected, 'settings.json'), JSON.stringify({ serverUrl: 'https://existing-relay.example' }));
            process.env.TALOS_SERVER_URL = 'https://selected-relay.example/';
            expect(loadConfig().serverUrl).toBe('https://selected-relay.example');
        });

        it('falls back safely when the saved settings are malformed', () => {
            const selected = join(state.home, '.talos');
            mkdirSync(selected);
            writeFileSync(join(selected, 'settings.json'), '{invalid');
            expect(loadConfig().serverUrl).toBe('https://api.talosapp.ai');
        });
    });
});
