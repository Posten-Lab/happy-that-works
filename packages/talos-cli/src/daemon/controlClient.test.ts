import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { config, getProcessIdentity, getProcessStartTime } = vi.hoisted(() => ({
    config: { daemonLockFile: '', daemonStateFile: '', currentCliVersion: 'test' },
    getProcessIdentity: vi.fn(), getProcessStartTime: vi.fn(),
}));
vi.mock('@/configuration', () => ({ configuration: config }));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn() } }));
vi.mock('@/utils/processIdentity', () => ({ getProcessIdentity, getProcessStartTime }));
import { acquireDaemonLock, clearDaemonState, type DaemonLocallyPersistedState } from '@/persistence';
import { checkIfDaemonRunningAndCleanupStaleState, stopDaemon } from './controlClient';

describe('daemon control process ownership', () => {
    let directory: string;
    const fetchMock = vi.fn();
    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), 'talos-daemon-control-'));
        config.daemonLockFile = join(directory, 'daemon.lock');
        config.daemonStateFile = join(directory, 'daemon.state.json');
        getProcessIdentity.mockReturnValue('boot:owner');
        getProcessStartTime.mockReturnValue(Date.now() - 60_000);
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
        // Never deliver real signals in these ownership regression tests.
        vi.spyOn(process, 'kill').mockReturnValue(true);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        rmSync(directory, { recursive: true, force: true });
    });

    function writeState(overrides: Partial<DaemonLocallyPersistedState> = {}) {
        const state: DaemonLocallyPersistedState = {
            pid: process.pid, processIdentity: 'boot:owner', httpPort: 32123,
            startTime: 'original start', startedWithCliVersion: 'test', ...overrides,
        };
        writeFileSync(config.daemonStateFile, JSON.stringify(state));
        writeFileSync(config.daemonLockFile, JSON.stringify({ version: 1, pid: process.pid, processIdentity: 'boot:owner' }));
        return state;
    }

    it('preserves a live daemon state and exclusive lock after an HTTP timeout', async () => {
        writeState();
        fetchMock.mockRejectedValue(new Error('HTTP timed out'));
        expect(await checkIfDaemonRunningAndCleanupStaleState()).toBe(false);
        expect(existsSync(config.daemonStateFile)).toBe(true);
        expect(await acquireDaemonLock(1, 0)).toBeNull();
    });

    it('state cleanup cannot release the live lock or erase a replacement daemon', async () => {
        const oldState = writeState();
        await clearDaemonState(oldState);
        expect(existsSync(config.daemonStateFile)).toBe(false);
        expect(await acquireDaemonLock(1, 0)).toBeNull();
        const replacement = writeState({ processIdentity: 'boot:replacement', startTime: 'replacement start' });
        await clearDaemonState(oldState);
        expect(JSON.parse(readFileSync(config.daemonStateFile, 'utf8'))).toEqual(replacement);
    });

    it('never contacts or signals a PID reused since the saved daemon birth', async () => {
        writeState({ processIdentity: 'previous-boot:owner' });
        await stopDaemon();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(process.kill).not.toHaveBeenCalledWith(process.pid, 'SIGKILL');
        expect(existsSync(config.daemonStateFile)).toBe(false);
        expect(existsSync(config.daemonLockFile)).toBe(true);
    });

    it('rejects reused PIDs from a legacy daemon state predating their birth', async () => {
        writeState({ processIdentity: undefined });
        const previousBoot = new Date(Date.now() - 120_000);
        utimesSync(config.daemonStateFile, previousBoot, previousBoot);
        await stopDaemon();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(process.kill).not.toHaveBeenCalledWith(process.pid, 'SIGKILL');
    });

    it('stops a verified live legacy daemon through its existing HTTP endpoint', async () => {
        writeState({ processIdentity: undefined });
        fetchMock.mockImplementation(async () => {
            getProcessIdentity.mockReturnValue(null);
            return { ok: true, json: async () => ({}) };
        });
        await stopDaemon();
        expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:32123/stop', expect.anything());
        expect(process.kill).not.toHaveBeenCalledWith(process.pid, 'SIGKILL');
    });

    it('preserves unknown legacy ownership instead of force killing it', async () => {
        writeState({ processIdentity: undefined });
        getProcessStartTime.mockReturnValue(null);
        await stopDaemon();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(process.kill).not.toHaveBeenCalledWith(process.pid, 'SIGKILL');
        expect(existsSync(config.daemonStateFile)).toBe(true);
    });

    it('force stops a hung daemon only while its captured birth still matches', async () => {
        vi.useFakeTimers();
        writeState();
        fetchMock.mockRejectedValue(new Error('not responding'));
        const stopped = stopDaemon();
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
        await vi.advanceTimersByTimeAsync(2100);
        await stopped;
        expect(process.kill).toHaveBeenCalledWith(process.pid, 'SIGKILL');
    });

    it('does not force kill a PID reused exactly when the graceful-stop deadline expires', async () => {
        vi.useFakeTimers();
        writeState();
        let deadline = Infinity;
        getProcessIdentity.mockImplementation(() => Date.now() >= deadline ? 'boot:replacement' : 'boot:owner');
        fetchMock.mockImplementation(async () => {
            deadline = Date.now() + 2000;
            throw new Error('not responding');
        });
        const stopped = stopDaemon();
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
        await vi.advanceTimersByTimeAsync(2100);
        await stopped;
        expect(process.kill).not.toHaveBeenCalledWith(process.pid, 'SIGKILL');
    });
});
