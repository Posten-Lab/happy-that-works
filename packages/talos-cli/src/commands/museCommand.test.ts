import { describe, expect, it, vi } from 'vitest';
vi.mock('@/ui/auth', () => ({ authAndSetupMachineIfNeeded: vi.fn() }));
vi.mock('@/daemon/ensureDaemonRunning', () => ({ ensureDaemonRunning: vi.fn() }));
vi.mock('@/muse/runMuse', () => ({ runMuse: vi.fn() }));
import { parseMuseArgs } from './museCommand';

describe('Muse command arguments', () => {
    it('preserves native flags after the separator', () => {
        expect(parseMuseArgs(['--resume', '01a07b19-6dd0-7740-a31e-621cd1829789', '--', '--model', 'muse-spark-1.3'])).toMatchObject({
            resumeId: '01a07b19-6dd0-7740-a31e-621cd1829789', nativeArgs: ['--model', 'muse-spark-1.3'],
        });
    });
    it('rejects options that would break same-session handoff', () => {
        expect(() => parseMuseArgs(['--', '--no-session-log'])).toThrow('persistence');
        expect(() => parseMuseArgs(['--', '--workspace=/other'])).toThrow('workspace');
        expect(() => parseMuseArgs(['--resume'])).toThrow('UUID');
        expect(() => parseMuseArgs(['--started-by', 'daemon', '--talos-starting-mode', 'local'])).toThrow('remote');
    });
});
