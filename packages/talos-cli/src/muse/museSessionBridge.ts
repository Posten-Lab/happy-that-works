import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { projectPath } from '@/projectPath';
import { museExecutable } from './museClient';

const execute = promisify(execFile);
const bridgeDirectory = () => join(homedir(), '.talos', 'muse', 'bridges');

export function museSessionInstructions(): string {
    const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
    const command = `${quote(process.execPath)} ${quote(join(projectPath(), 'bin', 'talos-mcp.mjs'))} --muse-session`;
    return `This is a Talos chat. At the beginning of a new conversation, on a substantial topic change, or when asked to rename this chat, call mcp__plugin_talos_session_talos__change_title with a concise title. To show a local image, call mcp__plugin_talos_session_talos__present_image with its absolute path. Use write_todos for multi-step work; Talos displays its full list as live progress.\n\nMuse 1.0.3 can lose MCP tools after native terminal handoff. If these tools are unavailable, invoke the SAME Talos tools through the terminal instead:\n${command} --call change_title --arguments '{"title":"Task title"}'\n${command} --call present_image --arguments '{"path":"/absolute/image.png"}'\nUse valid JSON and shell quoting for your arguments. Do not search the repository for a rename implementation. These commands work only inside a session launched by Talos.`;
}

/** Muse deliberately filters MCP child environments. Route by launcher ancestry instead. */
export async function findMuseSessionBridge(): Promise<string | undefined> {
    let pid = process.ppid;
    for (let depth = 0; depth < 32 && pid > 1; depth++) {
        try {
            const record = JSON.parse(await readFile(join(bridgeDirectory(), `${pid}.json`), 'utf8'));
            const url = new URL(record.url);
            const { stdout } = await execute('ps', ['-o', 'lstart=', '-p', String(pid)], { timeout: 2000 });
            if (record.startedAt === stdout.trim() && url.protocol === 'http:' && url.hostname === '127.0.0.1') return url.href;
        } catch { /* This ancestor is not a Talos session launcher. */ }
        const { stdout } = await execute('ps', ['-o', 'ppid=', '-p', String(pid)], { timeout: 2000 }).catch(() => ({ stdout: '' }));
        const parent = Number(stdout.trim());
        if (!Number.isSafeInteger(parent) || parent <= 0 || parent === pid) break;
        pid = parent;
    }
    return undefined;
}

export async function registerMuseSessionBridge(url: string): Promise<() => Promise<void>> {
    await mkdir(bridgeDirectory(), { recursive: true, mode: 0o700 });
    const path = join(bridgeDirectory(), `${process.pid}.json`);
    const { stdout } = await execute('ps', ['-o', 'lstart=', '-p', String(process.pid)], { timeout: 2000 });
    if (!stdout.trim()) throw new Error('Cannot identify the Talos launcher for Muse session tools');
    await writeFile(path, JSON.stringify({ url, startedAt: stdout.trim() }), { mode: 0o600 });
    return async () => { await unlink(path).catch(() => {}); };
}

/** Install only Talos's bridge capability using Muse's own plugin manager. */
export async function ensureMuseSessionPlugin() {
    const directory = join(bridgeDirectory(), 'plugin');
    const manifestDirectory = join(directory, '.muse-plugin');
    const manifest = JSON.stringify({
        schemaVersion: 1, name: 'talos-session', displayName: 'Talos Session', version: '1.0.0',
        description: 'Talos session naming and image tools',
        compat: { source: 'native', manifestDir: '.muse-plugin' },
        capabilities: { skills: [{ id: 'talos-session', path: 'skills/talos-session/SKILL.md', enabledDefault: true }], hooks: [], commands: [], mcpServers: [{
            id: 'talos', transport: 'stdio',
            command: [process.execPath, join(projectPath(), 'bin', 'talos-mcp.mjs'), '--muse-session'],
        }] },
    });
    const path = join(manifestDirectory, 'plugin.json');
    const skillDirectory = join(directory, 'skills', 'talos-session');
    const skill = `---\nname: talos-session\ndescription: Use for naming or renaming this Talos chat, sharing local images, and tracking task progress. Includes the session tool fallback for native terminal handoff.\n---\n\n${museSessionInstructions()}\n`;
    let previous: string | undefined;
    try { previous = await readFile(path, 'utf8'); } catch { /* First installation. */ }
    const run = async (args: string[]) => JSON.parse((await execute(museExecutable(), ['plugins', ...args, '--json'], { timeout: 20000 })).stdout);
    const installed = await run(['list']);
    const present = Array.isArray(installed.plugins) && installed.plugins.some((p: { record?: { id: string } }) => p.record?.id === 'talos-session');
    let previousSkill: string | undefined;
    try { previousSkill = await readFile(join(skillDirectory, 'SKILL.md'), 'utf8'); } catch { /* First installation. */ }
    if (!present || previous !== manifest || previousSkill !== skill) {
        console.log('Installing the Talos session tools plugin for Muse.');
        await mkdir(manifestDirectory, { recursive: true, mode: 0o700 });
        await writeFile(path, manifest, { mode: 0o600 });
        await mkdir(skillDirectory, { recursive: true, mode: 0o700 });
        await writeFile(join(skillDirectory, 'SKILL.md'), skill, { mode: 0o600 });
        // Reinstall updates the source as well as the capability definition after CLI upgrades.
        await run(['install', directory, '--scope', 'user']);
    }
    await run(['enable', 'talos-session']);
    await run(['approve', 'talos-session:mcp_server:talos']);
}
