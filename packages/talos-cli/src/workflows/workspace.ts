import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { lstat, readFile, readlink, realpath, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const exec = promisify(execFile);
export async function git(cwd: string, args: string[]) {
    return (await exec('git', args, { cwd, timeout: 30000, maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
}
async function rejectSubmodules(directory: string) {
    if ((await git(directory, ['ls-files', '--stage'])).split('\n').some(line => line.startsWith('160000 '))) {
        throw new Error('Workflow verification does not support Git submodules. Choose a project without submodules.');
    }
}
export async function prepareWorkspace(source: string, home: string, id: string) {
    const root = await realpath(source);
    const repositoryRoot = await realpath(await git(root, ['rev-parse', '--show-toplevel']));
    if (root !== repositoryRoot) throw new Error('Choose the Git repository root directory.');
    await rejectSubmodules(root);
    if (await git(root, ['status', '--porcelain'])) throw new Error('Commit or stash project changes before starting a workflow.');
    const baseCommit = await git(root, ['rev-parse', 'HEAD']);
    const branch = `talos/workflow-${id}`;
    const parent = join(home, 'workflow-worktrees'); await mkdir(parent, { recursive: true, mode: 0o700 });
    const directory = join(parent, id);
    await git(root, ['worktree', 'add', '-b', branch, directory, baseCommit]);
    return { sourceDirectory: root, directory, branch, baseCommit };
}
/** Bind approvals to actual tracked and untracked nonignored bytes, not an agent's claimed revision. */
export async function workspaceVersion(directory: string) {
    await rejectSubmodules(directory);
    const { stdout } = await exec('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: directory, maxBuffer: 8 * 1024 * 1024 });
    const hash = createHash('sha256');
    for (const file of [...new Set(stdout.split('\0').filter(Boolean))].sort()) {
        hash.update(file).update('\0');
        try {
            const path = join(directory, file), stat = await lstat(path);
            hash.update(String(stat.mode)).update('\0');
            if (stat.isSymbolicLink()) hash.update(await readlink(path));
            else if (stat.isFile()) {
                if (stat.size > 20 * 1024 * 1024) throw new Error('Workflow file exceeds the 20 MB verification limit.');
                hash.update(await readFile(path));
            } else hash.update('directory');
        } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') hash.update('deleted'); else throw e; }
        hash.update('\0');
    }
    return hash.digest('hex');
}
