import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileHandle } from 'node:fs/promises';

const { config, getProcessIdentity, getProcessStartTime } = vi.hoisted(() => ({
    config: { daemonLockFile: '', daemonStateFile: '' },
    getProcessIdentity: vi.fn(), getProcessStartTime: vi.fn(),
}));
vi.mock('@/configuration', () => ({ configuration: config }));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn() } }));
vi.mock('@/utils/processIdentity', () => ({ getProcessIdentity, getProcessStartTime }));
import { acquireDaemonLock, readDaemonState, releaseDaemonLock } from './persistence';

describe('daemon ownership across reboot before account pairing', () => {
    let directory: string;
    const handles: FileHandle[] = [];
    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), 'talos-daemon-lock-'));
        config.daemonLockFile = join(directory, 'daemon.lock');
        config.daemonStateFile = join(directory, 'daemon.state.json');
        getProcessIdentity.mockReturnValue('current-boot:current-birth');
        getProcessStartTime.mockReturnValue(Date.now() - 10_000);
    });
    afterEach(async () => {
        for (const handle of handles.splice(0)) await releaseDaemonLock(handle);
        rmSync(directory, { recursive: true, force: true });
    });

    async function acquire() {
        const handle = await acquireDaemonLock(3, 0);
        if (handle) handles.push(handle);
        return handle;
    }

    it('stores private birth-aware ownership and refuses a second live owner', async () => {
        expect(await acquire()).not.toBeNull();
        expect(JSON.parse(readFileSync(config.daemonLockFile, 'utf8'))).toEqual({
            version: 1, pid: process.pid, processIdentity: 'current-boot:current-birth',
        });
        expect(statSync(config.daemonLockFile).mode & 0o777).toBe(0o600);
        expect(await acquire()).toBeNull();
    });

    it('reclaims a pre-pairing lock after the PID is reused on another boot', async () => {
        writeFileSync(config.daemonLockFile, JSON.stringify({ version: 1, pid: process.pid, processIdentity: 'previous-boot:birth' }));
        expect(await readDaemonState()).toBeNull();
        expect(await acquire()).not.toBeNull();
    });

    it('preserves a still-live legacy PID-only daemon', async () => {
        writeFileSync(config.daemonLockFile, String(process.pid));
        expect(await acquire()).toBeNull();
        expect(readFileSync(config.daemonLockFile, 'utf8')).toBe(String(process.pid));
    });

    it('reclaims a reused PID in a legacy lock when its new process started after the lock was written', async () => {
        writeFileSync(config.daemonLockFile, String(process.pid));
        const previousBoot = new Date(Date.now() - 60_000);
        utimesSync(config.daemonLockFile, previousBoot, previousBoot);
        getProcessStartTime.mockReturnValue(Date.now());
        expect(await acquire()).not.toBeNull();
    });

    it('reclaims a legacy lock after its owner exits', async () => {
        writeFileSync(config.daemonLockFile, '2147483647');
        expect(await acquire()).not.toBeNull();
    });

    it('preserves uncertain legacy ownership when process birth cannot be inspected', async () => {
        writeFileSync(config.daemonLockFile, String(process.pid));
        getProcessStartTime.mockReturnValue(null);
        expect(await acquire()).toBeNull();
    });

    it('recovers an incomplete crashed write while protecting a fresh writer', async () => {
        writeFileSync(config.daemonLockFile, '');
        expect(await acquire()).toBeNull();
        const old = new Date(Date.now() - 6000);
        utimesSync(config.daemonLockFile, old, old);
        expect(await acquire()).not.toBeNull();
    });

    it('does not remove a replacement lock when the former owner releases its handle', async () => {
        const first = await acquire();
        renameSync(config.daemonLockFile, `${config.daemonLockFile}.old`);
        expect(await acquire()).not.toBeNull();
        await releaseDaemonLock(first!);
        expect(JSON.parse(readFileSync(config.daemonLockFile, 'utf8')).processIdentity).toBe('current-boot:current-birth');
    });

    it('allows only one concurrent fresh owner', async () => {
        const results = await Promise.all([acquire(), acquire()]);
        expect(results.filter(Boolean)).toHaveLength(1);
    });
});
