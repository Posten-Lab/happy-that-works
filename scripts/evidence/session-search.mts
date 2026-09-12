/**
 * Isolated real-service fixture for session search (no mocked HTTP or agent daemon).
 *
 * pnpm exec tsx scripts/evidence/session-search.mts setup
 * pnpm exec tsx scripts/evidence/session-search.mts verify <environment-name>
 * pnpm exec tsx scripts/evidence/session-search.mts keepalive <environment-name>
 * pnpm exec tsx scripts/evidence/session-search.mts live-create <environment-name>
 * pnpm exec tsx scripts/evidence/session-search.mts live-rename <environment-name>
 * pnpm exec tsx scripts/evidence/session-search.mts live-archive <environment-name>
 * pnpm exec tsx scripts/evidence/session-search.mts live-delete <environment-name>
 * pnpm env:down <environment-name>
 *
 * Auth material stays under ignored environments/data and is never printed.
 * Sessions/messages are created using public APIs. Historical timestamps are
 * adjusted in this fixture's PGlite database only, with its server stopped.
 */
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { io } from 'socket.io-client';
import environmentManager from '../../environments/environments';
import { decryptLegacy, encryptLegacy } from '../../packages/talos-cli/src/api/encryption';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { createEnvironment, getEnvironmentDir, startEnvironmentServices, stopEnvironment } = environmentManager;
const day = 86_400_000;
type FixtureSession = { key: string; title: string; id: string; active: boolean; lastMessageAt: number; createdAt: number; messages: number; targetMessageId?: string; targetSeq?: number };
type Fixture = { environment: string; serverUrl: string; webUrl: string; createdAt: number; sessions: FixtureSession[] };
type Message = { role: 'user' | 'agent'; text: string };

async function waitFor(check: () => Promise<boolean>, label: string) {
    const start = Date.now();
    while (Date.now() - start < 60_000) {
        if (await check().catch(() => false)) return;
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    throw new Error(`Timed out waiting for ${label}`);
}

async function request<T>(base: string, token: string, route: string, body?: unknown, method?: 'DELETE'): Promise<T> {
    assert.equal(new URL(base).hostname, 'localhost', 'Fixtures must use the isolated loopback server');
    const response = await fetch(`${base}${route}`, {
        method: method ?? (body === undefined ? 'GET' : 'POST'),
        signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
    return response.json() as Promise<T>;
}

async function setup() {
    // Do not inherit external data services from the invoking shell.
    for (const key of ['DATABASE_URL', 'REDIS_URL', 'S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'DB_PROVIDER']) delete process.env[key];
    process.env.HOST = '127.0.0.1';
    process.env.EXPO_NO_TELEMETRY = '1';
    const environment = await createEnvironment({ noSwitch: true });
    const envDir = getEnvironmentDir(environment);
    const config = JSON.parse(await readFile(path.join(envDir, 'environment.json'), 'utf8'));
    const serverUrl = `http://localhost:${config.serverPort}`;
    const webUrl = `http://localhost:${config.expoPort}`;
    const logFd = openSync(path.join(envDir, 'server', 'stdout.log'), 'a');
    const server = spawn('pnpm', ['standalone', 'serve'], {
        cwd: path.join(root, 'packages/talos-server'), detached: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env, NODE_ENV: 'development', DB_PROVIDER: 'pglite', PORT: String(config.serverPort), DATA_DIR: path.join(envDir, 'server'), PGLITE_DIR: path.join(envDir, 'server/pglite'), TALOS_MASTER_SECRET: 'talos-dev-secret', METRICS_ENABLED: 'false' },
    });
    closeSync(logFd);
    server.unref();
    await mkdir(path.join(envDir, 'pids'), { recursive: true });
    await writeFile(path.join(envDir, 'pids/server.pid'), String(server.pid));
    await waitFor(async () => (await fetch(serverUrl)).ok, 'isolated server');

    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const jwk = publicKey.export({ format: 'jwk' });
    const challenge = randomBytes(32);
    const auth = await request<{ token: string }>(serverUrl, '', '/v1/auth', {
        publicKey: Buffer.from(jwk.x!, 'base64url').toString('base64'),
        challenge: challenge.toString('base64'), signature: sign(null, challenge, privateKey).toString('base64'),
    });
    const secret = randomBytes(32);
    await writeFile(path.join(envDir, 'cli/home/access.key'), JSON.stringify({ token: auth.token, secret: secret.toString('base64') }), { mode: 0o600 });
    await writeFile(path.join(envDir, 'cli/home/settings.json'), JSON.stringify({ schemaVersion: 2, onboardingCompleted: true, machineId: randomUUID() }), { mode: 0o600 });
    const now = Date.now();
    const sessions: FixtureSession[] = [];
    const encrypt = (value: unknown) => Buffer.from(encryptLegacy(value, secret)).toString('base64');

    async function add(key: string, title: string, active: boolean, daysAgo: number, messages: Message[], targetIndex?: number) {
        const created = await request<{ session: { id: string } }>(serverUrl, auth.token, '/v1/sessions', {
            tag: `search-e2e-${key}`,
            metadata: encrypt({ path: '/fixture/session-search', host: 'Search E2E', flavor: 'codex', summary: { text: title, updatedAt: now }, ...(active ? {} : { lifecycleState: 'archived', archivedBy: 'user', archiveReason: 'Search fixture' }) }),
        });
        const sent: { id: string; seq: number }[] = [];
        for (let offset = 0; offset < messages.length; offset += 100) {
            const batch = messages.slice(offset, offset + 100).map((message, index) => ({
                localId: `${key}-${offset + index}`,
                content: encrypt(message.role === 'user'
                    ? { role: 'user', content: { type: 'text', text: message.text } }
                    : { role: 'agent', content: { type: 'codex', data: { type: 'message', message: message.text } } }),
            }));
            const response = await request<{ messages: { id: string; seq: number }[] }>(serverUrl, auth.token, `/v3/sessions/${created.session.id}/messages`, { messages: batch });
            sent.push(...response.messages);
        }
        if (!active) await request(serverUrl, auth.token, `/v1/sessions/${created.session.id}/archive`, {});
        sessions.push({ key, title, id: created.session.id, active, lastMessageAt: now - daysAgo * day, createdAt: now - Math.max(daysAgo + 1, 181) * day, messages: messages.length, ...(targetIndex === undefined ? {} : { targetMessageId: sent[targetIndex].id, targetSeq: sent[targetIndex].seq }) });
    }

    await add('recent-archive', 'Release workflow', false, 3, [{ role: 'user', text: 'Please remember the copper lantern publishing checklist.' }, { role: 'agent', text: 'I recorded the release procedure for you.' }], 0);
    await add('old-archive', 'Historical planning', false, 120, [{ role: 'user', text: 'The amber telescope architecture decision is in this old conversation.' }], 0);
    await add('old-active', 'Long-running work', true, 150, [{ role: 'user', text: 'The cobalt compass requirement is still active.' }], 0);
    await add('title-match', 'Violet orchard migration', false, 8, [{ role: 'user', text: 'Start with the migration checklist.' }]);
    await add('assistant-only', 'Agent research notes', false, 4, [{ role: 'user', text: 'What did you find in the logs?' }, { role: 'agent', text: 'I found the silver otter diagnosis in the background worker.' }], 1);
    await add('long-history', 'Database investigation', false, 1, Array.from({ length: 230 }, (_, index): Message => ({ role: index % 2 === 0 ? 'user' : 'agent', text: index === 2 ? 'The hidden early-message marker is emerald falcon. Please investigate this original request.' : `Investigation update ${index + 1}: checked a routine database detail.` })), 2);
    await add('renamed-old', 'Recently renamed: crimson badger', false, 121, [{ role: 'user', text: 'The original older request discussed retention settings.' }]);
    await add('empty-recent', 'Empty recent title: teal swallow', false, 2, []);
    for (let index = 0; index < 155; index++) {
        await add(`filler-${index}`, `Routine project ${String(index + 1).padStart(3, '0')}`, false, 0.01 + index / 1000, [{ role: 'user', text: 'Please review the routine project task.' }]);
        if (index % 50 === 49) console.log(`Created ${sessions.length} encrypted fixture sessions through the API.`);
    }

    stopEnvironment(environment);
    await waitFor(async () => { try { await fetch(serverUrl); return false; } catch { return true; } }, 'server shutdown');
    const database = new PGlite(path.join(envDir, 'server/pglite'));
    await database.waitReady;
    try {
        for (const session of sessions) {
            const updatedAt = session.key === 'renamed-old' ? now : session.lastMessageAt;
            const createdAt = session.messages === 0 ? session.lastMessageAt : session.createdAt;
            await database.query('UPDATE "Session" SET "createdAt"=$1, "updatedAt"=$2, "lastActiveAt"=$3 WHERE id=$4', [new Date(createdAt), new Date(updatedAt), new Date(session.active ? now : session.lastMessageAt), session.id]);
            await database.query('UPDATE "SessionMessage" SET "createdAt"=$1::timestamp - (($2 - seq) * interval \'1 second\'), "updatedAt"=$1 WHERE "sessionId"=$3', [new Date(session.lastMessageAt), session.messages, session.id]);
            if (session.key === 'long-history') {
                await database.query('UPDATE "SessionMessage" SET "createdAt"=$1, "updatedAt"=$1 WHERE id=$2', [new Date(now - 180 * day), session.targetMessageId]);
            }
        }
    } finally { await database.close(); }
    const fixture: Fixture = { environment, serverUrl, webUrl, createdAt: now, sessions };
    await writeFile(path.join(envDir, 'session-search-fixture.json'), JSON.stringify(fixture, null, 2));
    await startEnvironmentServices(environment);
    await startKeepalive(environment);
    console.log(JSON.stringify({ environment, serverUrl, webUrl, sessions: sessions.length, fixturePath: path.join(envDir, 'session-search-fixture.json') }, null, 2));
    await verify(environment);
}

/** Keep only the old active fixture alive through the real session socket. */
async function startKeepalive(environment: string) {
    assert.match(environment, /^[a-z]+-[a-z]+$/);
    const envDir = getEnvironmentDir(environment);
    const pidFile = path.join(envDir, 'pids/session-search-keeper.pid');
    let existing = false;
    try { process.kill(Number(await readFile(pidFile, 'utf8')), 0); existing = true; } catch {}
    if (!existing) {
        const logFd = openSync(path.join(envDir, 'session-search-keeper.log'), 'a');
        const keeper = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), 'keepalive-worker', environment], {
            cwd: root, detached: true, stdio: ['ignore', logFd, logFd], env: { ...process.env, EXPO_NO_TELEMETRY: '1' },
        });
        closeSync(logFd);
        keeper.unref();
        await writeFile(pidFile, String(keeper.pid));
    }
    const fixture: Fixture = JSON.parse(await readFile(path.join(envDir, 'session-search-fixture.json'), 'utf8'));
    const { token } = JSON.parse(await readFile(path.join(envDir, 'cli/home/access.key'), 'utf8'));
    const session = fixture.sessions.find(item => item.key === 'old-active')!;
    await waitFor(async () => (await request<{ session: { active: boolean } }>(fixture.serverUrl, token, `/v1/sessions/${session.id}`)).session.active, 'old active fixture heartbeat');
    console.log(`Session fixture heartbeat running for ${environment}; it stops automatically with env:down.`);
}

async function keepaliveWorker(environment: string) {
    assert.match(environment, /^[a-z]+-[a-z]+$/);
    const envDir = getEnvironmentDir(environment);
    const fixture: Fixture = JSON.parse(await readFile(path.join(envDir, 'session-search-fixture.json'), 'utf8'));
    const { token } = JSON.parse(await readFile(path.join(envDir, 'cli/home/access.key'), 'utf8'));
    const session = fixture.sessions.find(item => item.key === 'old-active')!;
    const serverPid = Number(await readFile(path.join(envDir, 'pids/server.pid'), 'utf8'));
    assert.equal(new URL(fixture.serverUrl).hostname, 'localhost');
    const socket = io(fixture.serverUrl, { path: '/v1/updates', transports: ['websocket'], auth: { token, clientType: 'session-scoped', sessionId: session.id, talosClient: 'search-fixture' } });
    const heartbeat = () => { if (socket.connected) socket.emit('session-alive', { sid: session.id, time: Date.now(), thinking: false }); };
    socket.on('connect', heartbeat);
    await new Promise<void>(resolve => {
        const beats = setInterval(heartbeat, 20_000);
        const monitor = setInterval(() => { void (async () => {
            try {
                // The environment manager removes this PID file during env:down.
                const current = Number(await readFile(path.join(envDir, 'pids/server.pid'), 'utf8'));
                if (current !== serverPid) { stop(); return; }
                process.kill(serverPid, 0);
            } catch { stop(); }
        })(); }, 1000);
        let stopped = false;
        const stop = () => {
            if (stopped) return;
            stopped = true;
            clearInterval(beats); clearInterval(monitor); socket.disconnect();
            process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
            resolve();
        };
        process.on('SIGTERM', stop); process.on('SIGINT', stop);
    });
    await rm(path.join(envDir, 'pids/session-search-keeper.pid'), { force: true });
}

/** Each live stage is explicit so a browser can observe the real socket update. */
async function liveCheck(environment: string, stage: 'create' | 'rename' | 'archive' | 'delete') {
    assert.match(environment, /^[a-z]+-[a-z]+$/);
    const envDir = getEnvironmentDir(environment);
    const fixture: Fixture = JSON.parse(await readFile(path.join(envDir, 'session-search-fixture.json'), 'utf8'));
    const credentials = JSON.parse(await readFile(path.join(envDir, 'cli/home/access.key'), 'utf8'));
    const secret = Buffer.from(credentials.secret, 'base64');
    const encrypt = (value: unknown) => Buffer.from(encryptLegacy(value, secret)).toString('base64');
    const manifestPath = path.join(envDir, 'session-search-live-fixture.json');
    type LiveFixture = { id: string; title: string; query: string; targetMessageId: string; targetSeq: number; stage: string };
    let live: LiveFixture;
    if (stage === 'create') {
        const title = 'Live indexing check';
        const response = await request<{ session: { id: string } }>(fixture.serverUrl, credentials.token, '/v1/sessions', {
            tag: 'search-e2e-live-checks', metadata: encrypt({ path: '/fixture/session-search', host: 'Search E2E', flavor: 'codex', summary: { text: title, updatedAt: Date.now() } }),
        });
        const sent = await request<{ messages: { id: string; seq: number }[] }>(fixture.serverUrl, credentials.token, `/v3/sessions/${response.session.id}/messages`, {
            messages: [{ localId: 'live-request', content: encrypt({ role: 'user', content: { type: 'text', text: 'Please keep the indigo kestrel release request searchable as this conversation changes.' } }) }],
        });
        live = { id: response.session.id, title, query: 'indigo kestrel', targetMessageId: sent.messages[0].id, targetSeq: sent.messages[0].seq, stage };
    } else {
        live = JSON.parse(await readFile(manifestPath, 'utf8'));
        if (stage === 'rename') {
            const { session } = await request<{ session: { metadata: string; metadataVersion: number } }>(fixture.serverUrl, credentials.token, `/v1/sessions/${live.id}`);
            const metadata = decryptLegacy(Buffer.from(session.metadata, 'base64'), secret);
            assert(metadata, 'Fixture metadata must decrypt');
            live.title = 'Indigo kestrel renamed';
            const socket = io(fixture.serverUrl, { path: '/v1/updates', transports: ['websocket'], auth: { token: credentials.token, clientType: 'user-scoped', talosClient: 'search-fixture' } });
            try {
                await new Promise<void>((resolve, reject) => {
                    const timer = setTimeout(() => reject(new Error('Fixture socket connection timed out')), 10_000);
                    socket.once('connect', () => { clearTimeout(timer); resolve(); });
                    socket.once('connect_error', () => { clearTimeout(timer); reject(new Error('Fixture socket authentication failed')); });
                });
                const result = await socket.timeout(10_000).emitWithAck('update-metadata', {
                    sid: live.id, expectedVersion: session.metadataVersion,
                    metadata: encrypt({ ...metadata, summary: { text: live.title, updatedAt: Date.now() } }),
                });
                assert.equal(result.result, 'success', 'Fixture metadata update must succeed');
            } finally { socket.disconnect(); }
        } else if (stage === 'archive') {
            await request(fixture.serverUrl, credentials.token, `/v1/sessions/${live.id}/archive`, {});
        } else {
            await request(fixture.serverUrl, credentials.token, `/v1/sessions/${live.id}`, undefined, 'DELETE');
        }
        live.stage = stage;
    }
    await writeFile(manifestPath, JSON.stringify(live, null, 2));
    console.log(JSON.stringify({ environment, ...live }, null, 2));
}

async function verify(environment: string) {
    assert.match(environment, /^[a-z]+-[a-z]+$/, 'Expected an isolated environment name');
    const envDir = getEnvironmentDir(environment);
    const fixture: Fixture = JSON.parse(await readFile(path.join(envDir, 'session-search-fixture.json'), 'utf8'));
    const { token } = JSON.parse(await readFile(path.join(envDir, 'cli/home/access.key'), 'utf8'));
    type ListedSession = { id: string; lastMessageAt: number | null; active: boolean };
    async function list(cutoff?: number) {
        const result: ListedSession[] = [];
        let cursor: string | undefined;
        let pages = 0;
        do {
            const query = new URLSearchParams({ limit: '150', ...(cutoff === undefined ? {} : { lastMessageSince: String(cutoff) }), ...(cursor ? { cursor } : {}) });
            const page = await request<{ sessions: ListedSession[]; nextCursor?: string | null; hasMore?: boolean }>(fixture.serverUrl, token, `/v2/sessions?${query}`);
            result.push(...page.sessions);
            cursor = page.nextCursor ?? undefined;
            pages++;
            assert(pages <= 5, 'Pagination should terminate');
        } while (cursor);
        return { result, pages };
    }
    const recent = await list(Date.now() - 90 * day);
    const all = await list();
    const get = (key: string) => fixture.sessions.find(session => session.key === key)!;
    for (const key of ['recent-archive', 'old-active', 'title-match', 'assistant-only', 'long-history', 'empty-recent']) assert(recent.result.some(session => session.id === get(key).id), `${key} must be covered by default`);
    for (const key of ['old-archive', 'renamed-old']) assert(!recent.result.some(session => session.id === get(key).id), `${key} must be excluded by default`);
    assert.equal(all.result.length, fixture.sessions.length);
    assert(recent.pages > 1, 'Search must traverse beyond the ordinary 150-session list');
    for (const session of fixture.sessions) {
        assert.equal(all.result.find(item => item.id === session.id)?.lastMessageAt, session.messages === 0 ? null : session.lastMessageAt, `${session.key} must report its latest message timestamp`);
    }
    const ordinaryList = await request<{ sessions: ListedSession[] }>(fixture.serverUrl, token, '/v1/sessions');
    assert(!ordinaryList.sessions.some(session => session.id === get('recent-archive').id), 'Recent archive fixture must sit beyond the ordinary session list');
    const long = get('long-history');
    let afterSeq = 0;
    let hasMore = true;
    let messageCount = 0;
    let messagePages = 0;
    while (hasMore) {
        const page = await request<{ messages: { id: string; seq: number; content: { t: string } }[]; hasMore: boolean }>(fixture.serverUrl, token, `/v3/sessions/${long.id}/messages?after_seq=${afterSeq}&limit=100`);
        assert(page.messages.every(message => message.content.t === 'encrypted'));
        messageCount += page.messages.length;
        afterSeq = page.messages.at(-1)?.seq ?? afterSeq;
        hasMore = page.hasMore;
        messagePages++;
        assert(messagePages <= 4);
    }
    assert.equal(messageCount, 230);
    const report = { checkedAt: new Date().toISOString(), server: fixture.serverUrl, sessionsTotal: all.result.length, defaultSessions: recent.result.length, sessionPages: recent.pages, longSessionMessages: messageCount, longSessionPages: messagePages, assertions: ['Recent archived sessions included', 'Archived sessions older than 90 days excluded', 'Renaming an old archive does not change coverage', 'Active sessions older than 90 days included', 'Recent empty session title included', 'Pagination covers more than 150 sessions', 'A recent archive beyond the ordinary session list is covered', 'Latest message timestamps reported accurately', 'Message pagination covers 230 encrypted messages'], result: 'passed' };
    await writeFile(path.join(envDir, 'session-search-api-evidence.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
}

const [command, environment] = process.argv.slice(2);
if (command === 'setup') await setup();
else if (command === 'verify' && environment) await verify(environment);
else if (command === 'keepalive' && environment) await startKeepalive(environment);
else if (command === 'keepalive-worker' && environment) await keepaliveWorker(environment);
else if (command === 'live-create' && environment) await liveCheck(environment, 'create');
else if (command === 'live-rename' && environment) await liveCheck(environment, 'rename');
else if (command === 'live-archive' && environment) await liveCheck(environment, 'archive');
else if (command === 'live-delete' && environment) await liveCheck(environment, 'delete');
else throw new Error('Usage: pnpm exec tsx scripts/evidence/session-search.mts setup | <verify|keepalive|live-create|live-rename|live-archive|live-delete> <environment-name>');
