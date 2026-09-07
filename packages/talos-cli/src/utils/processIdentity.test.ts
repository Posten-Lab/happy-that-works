import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileSync, readFileSync } = vi.hoisted(() => ({ execFileSync: vi.fn(), readFileSync: vi.fn() }));
vi.mock('node:child_process', () => ({ execFileSync }));
vi.mock('node:fs', () => ({ readFileSync }));
import { getProcessIdentity, getProcessStartTime } from './processIdentity';

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const startedAt = '2026-09-07T21:45:12.1234567Z';

beforeEach(() => {
    Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'win32' });
    vi.stubEnv('SystemRoot', 'C:\\Windows');
    execFileSync.mockReset().mockReturnValue(`${startedAt}\r\n`);
    readFileSync.mockReset();
});
afterEach(() => {
    Object.defineProperty(process, 'platform', originalPlatform);
    vi.unstubAllEnvs();
});

describe('Windows process birth lookup', () => {
    it('uses bounded noninteractive PowerShell and passes the PID as data', () => {
        expect(getProcessIdentity(4242)).toBe(startedAt);
        expect(execFileSync).toHaveBeenCalledWith(
            'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
            ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', expect.stringContaining('$env:TALOS_PROCESS_QUERY_PID')],
            expect.objectContaining({ timeout: 2000, windowsHide: true, env: expect.objectContaining({ TALOS_PROCESS_QUERY_PID: '4242' }) }),
        );
        const command = execFileSync.mock.calls[0][1][4];
        expect(command).not.toContain('4242');
        expect(command).toContain('ToUniversalTime()');
        expect(command).toContain('InvariantCulture');
        expect(readFileSync).not.toHaveBeenCalled();
    });

    it('provides an epoch timestamp for legacy daemon ownership checks', () => {
        expect(getProcessStartTime(4242)).toBe(Date.parse(startedAt));
    });

    it('distinguishes two processes that reused the same PID', () => {
        execFileSync.mockReturnValueOnce(startedAt).mockReturnValueOnce('2026-09-07T21:45:13.1234567Z');
        expect(getProcessIdentity(4242)).not.toBe(getProcessIdentity(4242));
    });

    it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '42; Remove-Item' as unknown as number])(
        'rejects invalid PID %s before starting PowerShell', pid => {
            expect(getProcessIdentity(pid)).toBeNull();
            expect(getProcessStartTime(pid)).toBeNull();
            expect(execFileSync).not.toHaveBeenCalled();
        },
    );

    it.each(['', 'not a timestamp', '09/07/2026 21:45:12', '2026-09-07T21:45:12.1234567Z\nextra output'])(
        'rejects malformed process creation time %s', value => {
            execFileSync.mockReturnValue(value);
            expect(getProcessIdentity(4242)).toBeNull();
            expect(getProcessStartTime(4242)).toBeNull();
        },
    );

    it.each(['process exited', 'access denied', 'ETIMEDOUT'])('returns unknown ownership after %s', reason => {
        execFileSync.mockImplementation(() => { throw new Error(reason); });
        expect(getProcessIdentity(4242)).toBeNull();
        expect(getProcessStartTime(4242)).toBeNull();
    });

    it('retains the macOS process-birth adapter', () => {
        Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'darwin' });
        execFileSync.mockReturnValue('Mon Sep  7 21:45:12 2026\n');
        expect(getProcessIdentity(4242)).toBe('Mon Sep  7 21:45:12 2026');
        expect(execFileSync).toHaveBeenCalledWith('/bin/ps', ['-p', '4242', '-o', 'lstart='], expect.anything());
    });
});
