import { sep } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ read: vi.fn(), execute: vi.fn() }));
vi.mock('node:fs/promises', () => ({ readFile: mocks.read, mkdir: vi.fn(), writeFile: vi.fn(), unlink: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: mocks.execute }));
vi.mock('./museClient', () => ({ museExecutable: () => 'muse' }));
import { findMuseSessionBridge } from './museSessionBridge';

beforeEach(() => vi.resetAllMocks());
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
