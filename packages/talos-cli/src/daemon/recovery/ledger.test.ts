import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
vi.mock('@/configuration', () => ({ configuration: { talosHomeDir: '/unused', serverUrl: 'test' } }));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn() } }));
import { recoveryLedger } from './ledger';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('durable recovery retry status', () => {
    it('persists a private nonsecret budget scoped to its server and machine', () => {
        const home = mkdtempSync(join(tmpdir(), 'talos-recovery-ledger-'));
        directories.push(home);
        const entries = [{ sessionId: 'session', status: 'restoring' as const, attempts: 2, updatedAt: 123, retryAt: 30_123 }];
        recoveryLedger(home, 'server-a', 'machine-a').save(entries);
        expect(recoveryLedger(home, 'server-a', 'machine-a').load()).toEqual(entries);
        expect(recoveryLedger(home, 'server-b', 'machine-a').load()).toEqual([]);
        expect(recoveryLedger(home, 'server-a', 'machine-b').load()).toEqual([]);
        const path = join(home, 'recovery-status', readdirSync(join(home, 'recovery-status'))[0]);
        expect(statSync(path).mode & 0o777).toBe(0o600);
        expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(entries);
    });

    it('rejects a damaged ledger instead of silently resetting retry limits', () => {
        const home = mkdtempSync(join(tmpdir(), 'talos-recovery-ledger-'));
        directories.push(home);
        const ledger = recoveryLedger(home, 'server', 'machine');
        ledger.save([]);
        const path = join(home, 'recovery-status', readdirSync(join(home, 'recovery-status'))[0]);
        writeFileSync(path, '{broken');
        expect(() => ledger.load()).toThrow('Automatic retries are paused');
    });
});
