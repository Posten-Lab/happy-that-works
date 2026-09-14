import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, lstat, realpath, utimes } from 'node:fs/promises';
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
            const nestedWorkspace = await prepareWorkspace(nested, directory, 'nested');
            expect(nestedWorkspace.directory).toBe(await realpath(nested));
            expect(nestedWorkspace.branch).toBe('');
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

describe('ordinary workflow folders', () => {
    it('uses a non-Git folder directly without creating a repository or copying files', async () => {
        const root = await mkdtemp(join(tmpdir(), 'talos-folder-test-'));
        try {
            const source = join(root, 'source'); await mkdir(source);
            await writeFile(join(source, 'notes.txt'), 'original');
            const workspace = await prepareWorkspace(source, join(root, 'home'), 'plain');
            expect(workspace.directory).toBe(workspace.sourceDirectory);
            expect(workspace.branch).toBe(''); expect(workspace.baseCommit).toBe('');
            expect(await readFile(join(source, 'notes.txt'), 'utf8')).toBe('original');
            await expect(lstat(join(source, '.git'))).rejects.toMatchObject({ code: 'ENOENT' });
            const before = await workspaceVersion(workspace.directory);
            await writeFile(join(source, 'notes.txt'), 'changed');
            expect(await workspaceVersion(workspace.directory)).not.toBe(before);
        } finally { await rm(root, { recursive: true, force: true }); }
    });
    it('accepts uncommitted and unborn repositories without discarding their working files', async () => {
        const root = await mkdtemp(join(tmpdir(), 'talos-folder-git-'));
        try {
            await git(root, ['init']); await writeFile(join(root, 'draft.txt'), 'not committed');
            const unborn = await prepareWorkspace(root, join(root, 'home'), 'unborn');
            expect(unborn.directory).toBe(unborn.sourceDirectory); expect(unborn.baseCommit).toBe('');
            await git(root, ['add', '.']); await git(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Fixture']);
            await writeFile(join(root, 'draft.txt'), 'in progress');
            const dirty = await prepareWorkspace(root, join(root, 'home'), 'dirty');
            expect(dirty.directory).toBe(dirty.sourceDirectory); expect(dirty.branch).toBe('');
            expect(await readFile(join(root, 'draft.txt'), 'utf8')).toBe('in progress');
        } finally { await rm(root, { recursive: true, force: true }); }
    });
    it('versions nested repositories, root files and symlink targets without hashing Git metadata or dependencies', async () => {
        const root = await mkdtemp(join(tmpdir(), 'talos-multi-repo-'));
        try {
            const source = join(root, 'workspace'), repo = join(source, 'backend'); await mkdir(repo, { recursive: true });
            await git(repo, ['init']); await writeFile(join(repo, '.gitignore'), 'cache/\n');
            await writeFile(join(repo, 'app.ts'), 'before');
            await mkdir(join(repo, 'cache')); await writeFile(join(repo, 'cache', 'generated'), 'ignored');
            await mkdir(join(source, 'node_modules')); await writeFile(join(source, 'node_modules', 'dependency'), 'ignored');
            await writeFile(join(source, 'README.md'), 'Workspace');
            const before = await workspaceVersion(source);
            await writeFile(join(repo, 'cache', 'generated'), 'updated cache');
            await writeFile(join(source, 'node_modules', 'dependency'), 'updated dependency');
            await git(repo, ['config', 'test.setting', 'changed']);
            expect(await workspaceVersion(source)).toBe(before);
            await writeFile(join(repo, 'app.ts'), 'after');
            const after = await workspaceVersion(source); expect(after).not.toBe(before);
            await writeFile(join(source, 'new.txt'), 'new'); expect(await workspaceVersion(source)).not.toBe(after);
            await symlink(root, join(source, 'outside'));
            const linked = await workspaceVersion(source);
            await writeFile(join(root, 'external.txt'), 'outside the workspace');
            expect(await workspaceVersion(source)).toBe(linked);
            await rm(join(source, 'outside')); await symlink(repo, join(source, 'outside'));
            expect(await workspaceVersion(source)).not.toBe(linked);
        } finally { await rm(root, { recursive: true, force: true }); }
    });
    it('rejects missing paths and files instead of creating a workspace there', async () => {
        const root = await mkdtemp(join(tmpdir(), 'talos-folder-invalid-'));
        try {
            await writeFile(join(root, 'file.txt'), 'file');
            await expect(prepareWorkspace(join(root, 'missing'), root, 'missing')).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(prepareWorkspace(join(root, 'file.txt'), root, 'file')).rejects.toThrow('folder');
        } finally { await rm(root, { recursive: true, force: true }); }
    });
    it('keeps worktree creation failures explicit instead of switching to direct writes', async () => {
        const root = await mkdtemp(join(tmpdir(), 'talos-worktree-error-'));
        try {
            const source = join(root, 'source'); await mkdir(source);
            await git(source, ['init']); await writeFile(join(source, 'file.txt'), 'original');
            await git(source, ['add', '.']); await git(source, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Fixture']);
            await git(source, ['branch', 'talos/workflow-existing']);
            await expect(prepareWorkspace(source, root, 'existing')).rejects.toThrow('already exists');
            expect(await git(source, ['status', '--porcelain'])).toBe('');
            expect(await readFile(join(source, 'file.txt'), 'utf8')).toBe('original');
        } finally { await rm(root, { recursive: true, force: true }); }
    });
    it('limits a nested project snapshot to the selected directory', async () => {
        const root = await mkdtemp(join(tmpdir(), 'talos-nested-scope-'));
        try {
            await git(root, ['init']); await mkdir(join(root, 'project'));
            await writeFile(join(root, 'outside.txt'), 'outside'); await writeFile(join(root, 'project', 'inside.txt'), 'inside');
            await git(root, ['add', '.']); await git(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Fixture']);
            const commit = await git(root, ['rev-parse', 'HEAD']);
            await git(root, ['update-index', '--add', '--cacheinfo', `160000,${commit},sibling-module`]);
            const before = await workspaceVersion(join(root, 'project'));
            await writeFile(join(root, 'outside.txt'), 'updated outside');
            expect(await workspaceVersion(join(root, 'project'))).toBe(before);
            await writeFile(join(root, 'project', 'inside.txt'), 'updated inside');
            expect(await workspaceVersion(join(root, 'project'))).not.toBe(before);
        } finally { await rm(root, { recursive: true, force: true }); }
    });
    it('includes tracked dependency-like paths and detects same-size edits with restored modification times', async () => {
        const root = await mkdtemp(join(tmpdir(), 'talos-tracked-assets-'));
        try {
            const repo = join(root, 'repo'); await mkdir(join(repo, 'node_modules'), { recursive: true }); await git(repo, ['init']);
            const file = join(repo, 'node_modules', 'tracked.txt'); await writeFile(file, 'before'); await git(repo, ['add', '.']);
            const before = await workspaceVersion(root), previous = await lstat(file);
            await writeFile(file, 'edited'); await utimes(file, previous.atime, previous.mtime);
            expect(await workspaceVersion(root)).not.toBe(before);
            const edited = await workspaceVersion(root); await rm(file);
            expect(await workspaceVersion(root)).not.toBe(edited);
        } finally { await rm(root, { recursive: true, force: true }); }
    });
    it('streams large ordinary files instead of failing review after a successful start', async () => {
        const root = await mkdtemp(join(tmpdir(), 'talos-large-folder-'));
        try {
            const file = join(root, 'archive.bin'); await writeFile(file, Buffer.alloc(21 * 1024 * 1024, 1));
            const first = await workspaceVersion(root);
            await writeFile(file, Buffer.alloc(21 * 1024 * 1024, 2));
            expect(await workspaceVersion(root)).not.toBe(first);
        } finally { await rm(root, { recursive: true, force: true }); }
    });
});
