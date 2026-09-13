/** Real Codex → built Talos CLI → local relay completion notification probe.
 * Takes about eleven minutes. No provider/relay mocks and no host daemon changes.
 * The disposable account has no device tokens; observes the real push endpoint's
 * session-event broadcast, not delivery through Expo/APNs to a physical phone.
 * Run after building the CLI: pnpm --filter talosapp exec tsx tests/codex-e2e/completion-push-probe.ts
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { io } from 'socket.io-client';
import { createIntegrationEnvironment, destroyIntegrationEnvironment } from '../../src/testing/integrationEnvironment';

const require = createRequire(import.meta.url);
const { createClient } = require('../service-e2e/client.cjs');
const evidence: Array<Record<string, unknown>> = [];
function record(check: string, details: Record<string, unknown> = {}) {
    const entry = { check, ...details };
    evidence.push(entry);
    console.log(JSON.stringify(entry));
}
async function waitFor(check: string, predicate: () => unknown | Promise<unknown>, timeoutMs = 60000) {
    const until = Date.now() + timeoutMs;
    while (!await predicate()) {
        if (Date.now() >= until) throw new Error(`Timed out: ${check}`);
        await new Promise(resolve => setTimeout(resolve, 500));
    }
}

process.env.TALOS_AUTOSTART = '0';
process.env.TALOS_DISABLE_CAFFEINATE = '1';
// pnpm may put an older workspace Codex ahead of the installed, authenticated CLI.
if (process.env.TALOS_COMPLETION_CODEX) {
    process.env.PATH = dirname(resolve(process.env.TALOS_COMPLETION_CODEX)) + delimiter + process.env.PATH;
}
// A probe launched inside Talos must not inherit the host daemon's child marker.
delete process.env.TALOS_SERVICE_MANAGED;
delete process.env.TALOS_DAEMON_CHILD;
for (const key of Object.keys(process.env)) {
    if (key.startsWith('TALOS_RECONNECT_')) delete process.env[key];
}
// The seed helper prints an authenticated URL; never include it in evidence.
const originalLog = console.log;
console.log = () => {};
const env = await createIntegrationEnvironment().finally(() => { console.log = originalLog; });
const home = join(env.envDir, 'cli', 'home');
const serverUrl = `http://localhost:${env.serverPort}`;
const { token } = JSON.parse(await readFile(join(home, 'access.key'), 'utf8'));
const { machineId } = JSON.parse(await readFile(join(home, 'settings.json'), 'utf8'));
const socket = io(serverUrl, { path: '/v1/updates', transports: ['websocket'], auth: { token }, reconnection: false });
let client: Awaited<ReturnType<typeof createClient>>;
let sessionId: string | undefined;
let thinking = false;
let beganAt = 0;
const notifications: Array<{ at: number; kind: string }> = [];
socket.on('ephemeral', event => {
    if (event.type === 'activity' && event.id === sessionId) {
        thinking = event.thinking;
        if (thinking && !beganAt) beganAt = Date.now();
    }
    if (event.type === 'session-event' && event.sessionId === sessionId) {
        notifications.push({ at: Date.now(), kind: event.kind });
        record('server-received-notification', { kind: event.kind, elapsedMs: Date.now() - beganAt });
    }
});
const doneCount = () => notifications.filter(event => event.kind === 'done').length;
try {
    await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
    });
    client = await createClient({ serverUrl, home });
    await waitFor('daemon registration', async () => (await client.request('/v1/machines')).some((machine: any) => machine.id === machineId));
    const spawned = await client.rpc(machineId, 'spawn-happy-session', { directory: env.projectPath, agent: 'codex' });
    assert.equal(spawned.type, 'success');
    sessionId = spawned.sessionId;
    if (!process.env.TALOS_COMPLETION_CONTROLS_ONLY) {
        await client.send(sessionId, 'This is a notification timing acceptance test. Run /bin/sleep 620 in the shell, wait until that command has actually exited, then reply exactly TALOS_LONG_TURN_COMPLETE. Do not finish early, modify files, delegate work, or ask questions. Poll the command as needed.', { permissionMode: 'yolo', model: 'gpt-5.5', effort: 'low' });
        await waitFor('Codex started', () => beganAt > 0);
        record('real-codex-turn-started');
        for (let minute = 1; minute <= 10; minute++) {
            await waitFor(`minute ${minute}`, () => Date.now() - beganAt >= minute * 60000, 65000);
            assert.equal(doneCount(), 0, `premature completion push at minute ${minute}`);
            assert.equal(thinking, true, `thinking cleared at minute ${minute}`);
            record('still-working-without-completion-push', { minute });
        }
        await waitFor('past former deadline', () => Date.now() - beganAt >= 605000, 10000);
        assert.equal(doneCount(), 0);
        assert.equal(thinking, true);
        record('past-ten-minute-deadline', { elapsedMs: Date.now() - beganAt });
        await waitFor('real completion push', () => doneCount() === 1, 120000);
        await waitFor('completion persisted', async () => {
            const messages = await client.messages(sessionId);
            return messages.some((m: any) => m.body.role !== 'user' && JSON.stringify(m.body).includes('TALOS_LONG_TURN_COMPLETE'));
        });
        await waitFor('completion idle', () => !thinking);
        record('long-turn-completed-once', { doneCount: doneCount(), elapsedMs: Date.now() - beganAt });
    }

    const beforeAbort = doneCount();
    await client.send(sessionId, 'Run /bin/sleep 60 now and wait for it to finish before replying. Do not modify files or delegate.', { permissionMode: 'yolo' });
    await waitFor('abort turn started', () => thinking);
    // Abort has a void result; the legacy helper expects a JSON object result.
    const aborted = await socket.timeout(30000).emitWithAck('rpc-call', {
        method: `${sessionId}:abort`, params: client.encrypt({}),
    });
    assert.equal(aborted.ok, true);
    await waitFor('abort idle', () => !thinking);
    await new Promise(resolve => setTimeout(resolve, 2500));
    assert.equal(doneCount(), beforeAbort);
    record('cancelled-turn-did-not-send-done');

    await client.send(sessionId, 'Reply exactly TALOS_FOLLOWUP_COMPLETE. Do not use tools.');
    await waitFor('follow-up completion', () => doneCount() === beforeAbort + 1);
    await waitFor('follow-up persisted', async () => (await client.messages(sessionId)).some((m: any) => m.body.role !== 'user' && JSON.stringify(m.body).includes('TALOS_FOLLOWUP_COMPLETE')));
    record('followup-completed-once', { doneCount: doneCount() });
    if (process.env.TALOS_COMPLETION_EVIDENCE) {
        await writeFile(process.env.TALOS_COMPLETION_EVIDENCE, JSON.stringify(evidence, null, 2) + '\n');
    }
} finally {
    if (client && sessionId) await client.rpc(machineId, 'stop-session', { sessionId }).catch(() => {});
    client?.close();
    socket.close();
    if (process.env.TALOS_KEEP_E2E) console.log(`Retained E2E environment: ${env.envDir}`);
    else await destroyIntegrationEnvironment(env);
}
