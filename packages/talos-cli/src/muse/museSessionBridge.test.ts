import { sep } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ read: vi.fn(), execute: vi.fn() }));
vi.mock('node:fs/promises', () => ({ readFile: mocks.read, mkdir: vi.fn(), writeFile: vi.fn(), unlink: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: mocks.execute }));
vi.mock('./museClient', () => ({ museExecutable: () => 'muse' }));
import { ensureMuseSessionPlugin, findMuseSessionBridge, museSessionInstructions } from './museSessionBridge';

beforeEach(() => vi.resetAllMocks());
describe('Muse session plugin capability', () => {
    it.each(['stdout', 'stderr'])('uses the terminal fallback when the build reports no plugins on %s', async stream => {
        mocks.execute.mockImplementation((_command, _args, _options, callback) => {
            callback(Object.assign(new Error('Command failed'), { [stream]: 'plugins are not available in this build\n' }));
        });
        expect(await ensureMuseSessionPlugin()).toBe(false);
        expect(mocks.execute).toHaveBeenCalledTimes(1);
        expect(mocks.read).not.toHaveBeenCalled();
        const instructions = museSessionInstructions(false);
        expect(instructions).toContain('--call change_title');
        expect(instructions).toContain('--call present_image');
        expect(instructions).toContain('write_todos');
        expect(instructions).not.toContain('mcp__plugin');
    });
    it('preserves unexpected plugin discovery failures', async () => {
        const error = Object.assign(new Error('Permission denied'), { stderr: 'Cannot read plugin registry' });
        mocks.execute.mockImplementation((_command, _args, _options, callback) => callback(error));
        await expect(ensureMuseSessionPlugin()).rejects.toBe(error);
    });
    it('installs and enables the plugin on builds that support it', async () => {
        mocks.execute.mockImplementation((_command, args, _options, callback) => {
            callback(null, { stdout: JSON.stringify(args[1] === 'list' ? { plugins: [] } : {}) });
        });
        expect(await ensureMuseSessionPlugin()).toBe(true);
        expect(mocks.execute.mock.calls.map(call => call[1][1])).toEqual(['list', 'install', 'enable', 'approve']);
    });
});

describe('Muse MCP session routing', () => {
    it('finds the launching session through intermediate native processes', async () => {
        mocks.read.mockRejectedValueOnce(new Error('no record')).mockResolvedValue(JSON.stringify({ url: 'http://127.0.0.1:1234', startedAt: 'launcher-start' }));
        mocks.execute.mockImplementation((_command, args, _options, callback) => {
            callback(null, { stdout: args[1] === 'ppid=' ? '42' : 'launcher-start' });
        });
        expect(await findMuseSessionBridge()).toBe('http://127.0.0.1:1234/');
        expect(mocks.read).toHaveBeenLastCalledWith(expect.stringContaining(`${sep}42.json`), 'utf8');
    });
    it.each([
        { url: 'http://127.0.0.1:1234', startedAt: 'previous-process' },
        { url: 'https://example.com', startedAt: 'launcher-start' },
    ])('ignores stale or non-local bridge records', async record => {
        mocks.read.mockResolvedValue(JSON.stringify(record));
        mocks.execute.mockImplementation((_command, args, _options, callback) => {
            callback(null, { stdout: args[1] === 'ppid=' ? '1' : 'launcher-start' });
        });
        expect(await findMuseSessionBridge()).toBeUndefined();
    });
});
