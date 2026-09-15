// Run with TALOS_E2E_CLI_ROOT pointing at a built CLI package. Uses the host's
// authenticated Muse and Talos accounts; deletes only the sessions it creates.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import nacl from 'tweetnacl';

assert.ok(process.env.TALOS_E2E_CLI_ROOT, 'Set TALOS_E2E_CLI_ROOT to a built CLI package');
const cli = resolve(process.env.TALOS_E2E_CLI_ROOT);
const home = process.env.TALOS_HOME_DIR || join(homedir(), '.talos');
const credentials = JSON.parse(readFileSync(join(home, 'access.key'), 'utf8'));
const settings = JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8'));
const server = process.env.TALOS_SERVER_URL || settings.serverUrl || 'https://api.talosapp.ai';
const workspace = mkdtempSync(join(tmpdir(), 'talos-muse-recovery-e2e-'));
const sessions = [];
const children = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(description, check, timeout = 120000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
        const result = await check();
        if (result) return result;
        await pause(1000);
    }
    throw new Error(`Timed out: ${description}`);
}
async function request(path, body, method = body ? 'POST' : 'GET') {
    const response = await fetch(server + path, {
        method, headers: { Authorization: `Bearer ${credentials.token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
    });
    assert.ok(response.ok, `${method} ${path}: ${response.status}`);
    return response.json();
}
function encrypt(value, encryption) {
    const key = Buffer.from(encryption.encryptionKey, 'base64');
    const text = Buffer.from(JSON.stringify(value));
    if (encryption.encryptionVariant === 'legacy') {
        const nonce = randomBytes(24);
        return Buffer.concat([nonce, nacl.secretbox(text, nonce, key)]).toString('base64');
    }
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    return Buffer.concat([Buffer.from([0]), nonce, cipher.update(text), cipher.final(), cipher.getAuthTag()]).toString('base64');
}
function decrypt(value, encryption) {
    const bytes = Buffer.from(value, 'base64');
    const key = Buffer.from(encryption.encryptionKey, 'base64');
    if (encryption.encryptionVariant === 'legacy') return JSON.parse(Buffer.from(nacl.secretbox.open(bytes.subarray(24), bytes.subarray(0, 24), key)).toString());
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(1, 13));
    decipher.setAuthTag(bytes.subarray(-16));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(13, -16)), decipher.final()]).toString());
}
async function start(resumeId) {
    const child = spawn(process.execPath, ['--no-warnings', '--no-deprecation', join(cli, 'dist/index.mjs'), 'muse',
        '--talos-starting-mode', 'remote', ...(resumeId ? ['--resume', resumeId] : [])], { cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const id = await until('Talos session creation', () => {
        if (child.exitCode !== null) throw new Error(`CLI exited: ${output}`);
        return output.match(/Talos session: (\w+)/)?.[1];
    }, 30000);
    sessions.push(id);
    const file = join(home, 'session-recovery', createHash('sha256').update(id).digest('hex') + '.json');
    const checkpoint = await until('native Muse session identity', () => {
        if (child.exitCode !== null) throw new Error(`CLI exited: ${output}`);
        try { const c = JSON.parse(readFileSync(file, 'utf8')); return c.metadata.museSessionId && c; } catch { return false; }
    }, 30000);
    const metadata = await until('Muse identity persisted on relay', async () => {
        const { session } = await request(`/v1/sessions/${id}`);
        const m = decrypt(session.metadata, checkpoint.encryption);
        return m.museSessionId && m;
    });
    assert.equal(metadata.museSessionId, checkpoint.metadata.museSessionId);
    if (resumeId) assert.equal(metadata.museSessionId, resumeId);
    console.log(JSON.stringify({ event: resumeId ? 'resumed' : 'started', sessionId: id, nativeSessionId: metadata.museSessionId }));
    return { id, child, encryption: checkpoint.encryption, nativeId: metadata.museSessionId };
}
async function prompt(session, text, expected) {
    const { messages: before } = await request(`/v3/sessions/${session.id}/messages?after_seq=0&limit=500`);
    const after = Math.max(0, ...before.map(m => m.seq));
    await request(`/v3/sessions/${session.id}/messages`, { messages: [{ localId: randomUUID(), content: encrypt({
        role: 'user', content: { type: 'text', text }, meta: { permissionMode: 'yolo', model: null, effort: 'low' },
    }, session.encryption) }] });
    const reply = await until('Muse assistant reply', async () => {
        const { messages } = await request(`/v3/sessions/${session.id}/messages?after_seq=${after}&limit=500`);
        return messages.map(m => decrypt(m.content.c, session.encryption))
            .find(m => m.role === 'agent' && m.content?.data?.type === 'message' && m.content.data.message.trim() === expected);
    });
    console.log(JSON.stringify({ event: 'reply', text: reply.content.data.message }));
}
async function stop(child) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGINT');
    await until('CLI shutdown', () => child.exitCode !== null || child.signalCode !== null, 20000);
}
try {
    const first = await start();
    await prompt(first, 'Remember the code word copper-otter-725. Rename this chat to Muse Recovery E2E using the Talos title tool, then reply only with the code word.', 'copper-otter-725');
    await until('terminal title tool persisted on relay', async () => {
        const { session } = await request(`/v1/sessions/${first.id}`);
        return decrypt(session.metadata, first.encryption).summary?.text === 'Muse Recovery E2E';
    });
    console.log(JSON.stringify({ event: 'terminal-title-tool', result: 'passed' }));
    await prompt(first, 'Run exactly sleep 8 using your terminal tool, wait for it to finish, then reply only with recovery-complete-725.', 'recovery-complete-725');
    const { messages } = await request(`/v3/sessions/${first.id}/messages?after_seq=0&limit=500`);
    const recoveryErrors = messages.map(m => decrypt(m.content.c, first.encryption)).filter(m => JSON.stringify(m).includes('Muse event recovery failed'));
    assert.equal(recoveryErrors.length, 0, 'Recovery polling must not emit error notices');
    console.log(JSON.stringify({ event: 'long-turn-recovery', errors: recoveryErrors.length, result: 'passed' }));
    await stop(first.child);
    const second = await start(first.nativeId);
    await prompt(second, 'What was the code word from the previous turn? Reply only with it. Do not use tools.', 'copper-otter-725');
    await stop(second.child);
    console.log(JSON.stringify({ event: 'result', result: 'passed' }));
} finally {
    for (const child of children) await stop(child).catch(() => child.kill('SIGKILL'));
    for (const id of sessions) await request(`/v1/sessions/${id}`, undefined, 'DELETE');
    rmSync(workspace, { recursive: true, force: true });
}
