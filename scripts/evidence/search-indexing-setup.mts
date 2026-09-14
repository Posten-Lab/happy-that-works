/** Seed a disposable real-server indexing benchmark. Auth stays in ignored environment data.
 * pnpm exec tsx scripts/evidence/search-indexing-setup.mts <environment-name>
 */
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { encryptLegacy } from '../../packages/talos-cli/src/api/encryption';

const [environment] = process.argv.slice(2);
assert.match(environment ?? '', /^[a-z]+-[a-z]+$/);
const directory = path.resolve('environments/data/envs', environment);
const config = JSON.parse(await readFile(path.join(directory, 'environment.json'), 'utf8'));
const server = `http://localhost:${config.serverPort}`;
let token = '';
async function post(route: string, body: unknown) {
    const response = await fetch(server + route, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    assert(response.ok, `${route}: HTTP ${response.status}`);
    return response.json();
}
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const challenge = randomBytes(32);
({ token } = await post('/v1/auth', { publicKey: Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url').toString('base64'), challenge: challenge.toString('base64'), signature: sign(null, challenge, privateKey).toString('base64') }));
const secret = randomBytes(32);
const encrypt = (value: unknown) => Buffer.from(encryptLegacy(value, secret)).toString('base64');
await writeFile(path.join(directory, 'search-indexing-auth.json'), JSON.stringify({ token, secret: secret.toString('base64url') }), { mode: 0o600 });
const machineId = randomUUID();
await post('/v1/machines', { id: machineId, metadata: encrypt({ host: 'Search benchmark device', platform: 'darwin', talosCliVersion: 'fixture', talosHomeDir: '/fixture/.talos', homeDir: '/fixture' }) });
const sessions = [];
for (let index = 0; index < 226; index++) {
    const count = index === 225 ? 10_000 : 20;
    const title = index === 225 ? 'Large searchable history' : `Benchmark conversation ${index + 1}`;
    const { session } = await post('/v1/sessions', { tag: `search-benchmark-${index}`, metadata: encrypt({ path: '/fixture/search', host: 'Search benchmark device', machineId, flavor: 'codex', summary: { text: title, updatedAt: Date.now() } }) });
    for (let offset = 0; offset < count; offset += 100) {
        const messages = Array.from({ length: Math.min(100, count - offset) }, (_, i) => ({
            localId: `${index}-${offset + i}`, content: encrypt({ role: 'user', content: { type: 'text', text: index === 224 && i === 0 ? 'Quicksilver benchmark needle for the short conversation.' : `Request ${offset + i + 1}: investigate search performance, encrypted history, durable progress and device synchronization for project ${index}.` } }),
        }));
        await post(`/v3/sessions/${session.id}/messages`, { messages });
    }
    sessions.push({ id: session.id, title, messages: count });
    if ((index + 1) % 50 === 0) console.log(`Seeded ${index + 1} sessions`);
}
const fixture = { server, web: `http://localhost:${config.expoPort}`, machineId, sessions, totalMessages: 14_500 };
await writeFile(path.join(directory, 'search-indexing-fixture.json'), JSON.stringify(fixture, null, 2));
console.log(JSON.stringify({ sessions: sessions.length, totalMessages: fixture.totalMessages, largestSession: 10_000 }));
