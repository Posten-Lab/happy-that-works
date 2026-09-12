import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { git, prepareWorkspace, workspaceVersion } from './workspace';

describe('real Git workflow workspaces', () => {
    it('isolates committed files, hashes edits and rejects unsupported submodules', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'talos-workspace-test-'));
        try {
            const source = join(directory, 'source'); await mkdir(source);
            await git(source, ['init']); await git(source, ['config', 'user.name', 'Workflow test']); await git(source, ['config', 'user.email', 'test@example.invalid']);
            await writeFile(join(source, 'result.txt'), 'before\n'); await git(source, ['add', '.']); await git(source, ['commit', '-m', 'Fixture']);
            const nested = join(source, 'nested'); await mkdir(nested);
            await expect(prepareWorkspace(nested, directory, 'nested')).rejects.toThrow('root directory');
            const workspace = await prepareWorkspace(source, directory, 'isolated');
            const before = await workspaceVersion(workspace.directory);
            await writeFile(join(workspace.directory, 'result.txt'), 'after\n');
            expect(await workspaceVersion(workspace.directory)).not.toBe(before);
            expect(await git(source, ['status', '--porcelain'])).toBe('');
            await git(workspace.directory, ['update-index', '--add', '--cacheinfo', `160000,${workspace.baseCommit},nested-module`]);
            await expect(workspaceVersion(workspace.directory)).rejects.toThrow('submodules');
        } finally { await rm(directory, { recursive: true, force: true }); }
    });
});
