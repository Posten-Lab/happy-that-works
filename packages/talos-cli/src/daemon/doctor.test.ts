import { beforeEach, describe, expect, it, vi } from 'vitest';
import psList from 'ps-list';
import { findAllTalosProcesses, findRunawayTalosProcesses } from './doctor';

vi.mock('ps-list', () => ({ default: vi.fn() }));

beforeEach(() => vi.resetAllMocks());

describe('Talos process isolation', () => {
  it('excludes an earlier daemon and unrelated JavaScript services from cleanup', async () => {
    vi.mocked(psList).mockResolvedValue([
      { pid: 91001, ppid: 1, name: 'node', cmd: 'node /opt/happy-cli/dist/index.mjs daemon start-sync' },
      { pid: 91002, ppid: 1, name: 'node', cmd: 'node /opt/other/dist/index.mjs daemon start-sync' },
      { pid: 91003, ppid: 1, name: 'node', cmd: 'node /opt/talos-agent/dist/index.mjs --version' },
      { pid: 91004, ppid: 1, name: 'talos-helper', cmd: 'talos-helper daemon start' },
      { pid: 91005, ppid: 1, name: 'node', cmd: 'node /opt/talos-cli/dist/index.mjs daemon start-sync' },
    ]);

    expect(await findRunawayTalosProcesses()).toEqual([
      { pid: 91005, command: 'node /opt/talos-cli/dist/index.mjs daemon start-sync' },
    ]);
  });

  it('finds packaged, workspace, wrapper, and Windows CLI entrypoints', async () => {
    const commands = [
      'node /usr/local/lib/node_modules/talos/dist/index.mjs daemon start-sync',
      'node /work/packages/talos-cli/src/index.ts daemon start-sync',
      'node /work/renamed-checkout/bin/talos.mjs daemon start-sync',
      'node.exe "C:\\Program Files\\node_modules\\talos\\dist\\index.mjs" daemon start-sync',
      'node /usr/local/lib/node_modules/talosapp/dist/index.mjs daemon start-sync',
    ];
    vi.mocked(psList).mockResolvedValue(commands.map((cmd, index) => ({
      pid: 92001 + index, ppid: 1, name: index === 3 ? 'node.exe' : 'node', cmd,
    })));

    expect((await findAllTalosProcesses()).map(p => p.command)).toEqual(commands);
  });
});
