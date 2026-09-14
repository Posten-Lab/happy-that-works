import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readlink, realpath, mkdir, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
const exec = promisify(execFile);
export async function git(cwd: string, args: string[]) {
    return (await exec('git', args, { cwd, timeout: 30000, maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
}
async function rejectSubmodules(directory: string) {
    if ((await git(directory, ['ls-files', '--stage', '--', '.'])).split('\n').some(line => line.startsWith('160000 '))) {
        throw new Error('Workflow verification does not support Git submodules. Choose a project without submodules.');
    }
}
/** A normal project folder need not be inside Git. Other Git failures stay visible. */
async function repositoryRoot(directory: string): Promise<string | undefined> {
    try { return await realpath(await git(directory, ['rev-parse', '--show-toplevel'])); }
    catch (error) {
        const failure = error as NodeJS.ErrnoException & { stderr?: string };
        if (/not a git repository/i.test(failure.stderr ?? '')) return undefined;
        throw error;
    }
}
export async function prepareWorkspace(source: string, home: string, id: string) {
    const root = await realpath(source);
    if (!(await lstat(root)).isDirectory()) throw new Error('Choose a project folder, not a file.');
    const direct = { sourceDirectory: root, directory: root, branch: '', baseCommit: '' };
    if (root !== await repositoryRoot(root)) return direct;
    await rejectSubmodules(root);
    if (await git(root, ['status', '--porcelain'])) return direct;
    let baseCommit: string;
    try { baseCommit = await git(root, ['rev-parse', '--verify', '--quiet', 'HEAD']); }
    catch (error) {
        if ((error as { code?: number }).code === 1) return direct;
        throw error;
    }
    const branch = `talos/workflow-${id}`;
    const parent = join(home, 'workflow-worktrees'); await mkdir(parent, { recursive: true, mode: 0o700 });
    const directory = join(parent, id);
    await git(root, ['worktree', 'add', '-b', branch, directory, baseCommit]);
    return { sourceDirectory: root, directory, branch, baseCommit };
}

// Only applies outside Git. Inside repositories, Git decides what is ignored,
// so tracked source never disappears merely because its directory has this name.
const generatedDirectories = new Set(['node_modules', '.venv', 'venv', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.cache']);

/** Include each nested repository's own files and ignore rules, never its .git metadata. */
async function workspaceFiles(directory: string, inGit: boolean): Promise<string[]> {
    const files = new Set<string>();
    const add = (path: string) => files.add(relative(directory, path));
    async function visit(folder: string, inGit: boolean) {
        if (inGit) {
            await rejectSubmodules(folder);
            const { stdout } = await exec('git', ['ls-files', '-co', '--exclude-standard', '-z', '--', '.'], { cwd: folder, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
            for (const name of new Set(stdout.split('\0').filter(Boolean))) {
                const path = join(folder, name);
                // Git paths are relative to cwd; never allow a scope expansion.
                const distance = relative(directory, path);
                if (distance === '..' || distance.startsWith(`..${sep}`)) throw new Error('Workflow file is outside the selected project folder.');
                // Git emits an embedded untracked repository as "name/";
                // ordinary tracked/untracked files do not need a second stat here.
                if (name.endsWith('/')) await visit(path, !!await repositoryRoot(path));
                else add(path);
            }
            return;
        }
        const entries = await readdir(folder, { withFileTypes: true });
        // A nested checkout or worktree can be inside an ordinary workspace.
        if (entries.some(entry => entry.name === '.git') && await repositoryRoot(folder)) return visit(folder, true);
        for (const entry of entries) {
            if (entry.name === '.git' || entry.name === '.DS_Store' || entry.isDirectory() && generatedDirectories.has(entry.name)) continue;
            const path = join(folder, entry.name);
            if (entry.isDirectory()) await visit(path, false);
            else add(path); // Symlinks are hashed as links and are never followed.
        }
    }
    await visit(directory, inGit);
    return [...files].sort();
}

/** Bind approvals to actual workspace bytes, including repositories inside a plain folder. */
export async function workspaceVersion(directory: string) {
    const inGit = !!await repositoryRoot(directory);
    const files = await workspaceFiles(directory, inGit);
    if (!inGit) {
        // Parent workspaces may contain many repositories. Hash independent files
        // concurrently with bounded memory, then combine in deterministic order.
        const contents = new Array<string>(files.length);
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(16, files.length) }, async () => {
            for (;;) {
                const index = next++;
                if (index >= files.length) return;
                const hash = createHash('sha256');
                await hashFile(hash, join(directory, files[index]));
                contents[index] = hash.digest('hex');
            }
        }));
        const hash = createHash('sha256').update('folder-v1\0');
        for (let index = 0; index < files.length; index++) hash.update(files[index]).update('\0').update(contents[index]).update('\0');
        return hash.digest('hex');
    }
    // Preserve the existing Git snapshot format for saved isolated runs.
    const hash = createHash('sha256');
    for (const file of files) {
        hash.update(file).update('\0');
        await hashFile(hash, join(directory, file));
        hash.update('\0');
    }
    return hash.digest('hex');
}

async function hashFile(hash: ReturnType<typeof createHash>, path: string): Promise<void> {
    try {
        const stat = await lstat(path);
        hash.update(String(stat.mode)).update('\0');
        if (stat.isSymbolicLink()) hash.update(await readlink(path));
        else if (stat.isFile()) {
            if (stat.size <= 1024 * 1024) hash.update(await readFile(path));
            else for await (const chunk of createReadStream(path)) hash.update(chunk);
        } else hash.update('directory');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') hash.update('deleted');
        else throw error;
    }
}
