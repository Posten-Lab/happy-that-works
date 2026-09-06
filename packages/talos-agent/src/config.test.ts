import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './config';

describe('config', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        delete process.env.TALOS_SERVER_URL;
        delete process.env.TALOS_HOME_DIR;
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    describe('defaults', () => {
        it('uses default server URL', () => {
            const config = loadConfig();
            expect(config.serverUrl).toBe('http://localhost:3005');
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
});
