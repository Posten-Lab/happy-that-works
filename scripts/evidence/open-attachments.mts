/** Real encrypted attachment fixture. Run: pnpm exec tsx scripts/evidence/open-attachments.mts */
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import environmentManager from '../../environments/environments';
import { encryptLegacy, encryptBlob, decryptBlob } from '../../packages/talos-cli/src/api/encryption';
import { deriveKey } from '../../packages/talos-cli/src/utils/deriveKey';
import { encryptionContexts } from '../../packages/talos-wire/src/compatibility';

for (const key of ['DATABASE_URL', 'REDIS_URL', 'S3_HOST', 'S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'DB_PROVIDER']) delete process.env[key];
process.env.HOST = '127.0.0.1';
process.env.EXPO_NO_TELEMETRY = '1';
const environment = process.argv[2] ?? await environmentManager.createEnvironment({ noSwitch: true });
const directory = environmentManager.getEnvironmentDir(environment);
if (!process.argv[2]) await environmentManager.startEnvironmentServices(environment);
const config = JSON.parse(await readFile(path.join(directory, 'environment.json'), 'utf8'));
const serverUrl = `http://localhost:${config.serverPort}`;
const webUrl = `http://localhost:${config.expoPort}`;
let token = '';
async function request(route: string, body?: unknown) {
    const result = await fetch(`${serverUrl}${route}`, {
        method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.ok(result.ok, `${route}: ${result.status}`);
    return result.json();
}
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const challenge = randomBytes(32);
token = (await request('/v1/auth', {
    publicKey: Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url').toString('base64'),
    challenge: challenge.toString('base64'), signature: sign(null, challenge, privateKey).toString('base64'),
})).token;
const secret = randomBytes(32);
const encrypt = (value: unknown) => Buffer.from(encryptLegacy(value, secret)).toString('base64');
const blobKey = await deriveKey(secret, encryptionContexts.blobs, ['master']);
const session = (await request('/v1/sessions', { tag: randomUUID(), metadata: encrypt({ path: '/fixture/attachments', host: 'Attachment E2E', flavor: 'codex', summary: { text: 'Open generated images and files', updatedAt: Date.now() } }) })).session;
const image = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#f8f5ee"/><text x="80" y="130" font-family="sans-serif" font-size="60" fill="#174f40">Generated image preview</text><text x="80" y="205" font-family="sans-serif" font-size="30" fill="#444">Tap to open, zoom to inspect, close to return.</text><rect x="80" y="285" width="920" height="100" rx="20" fill="#174f40"/><rect x="80" y="425" width="670" height="100" rx="20" fill="#e8bd70"/><text x="80" y="675" font-family="sans-serif" font-size="28">Original image: 1200 × 800 pixels</text></svg>')).png().toBuffer();
const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
const stream = 'BT /F1 28 Tf 60 300 Td (Decrypted Talos attachment) Tj 0 -60 Td /F1 16 Tf (This PDF opened from a chat file card.) Tj ET';
objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
let pdf = '%PDF-1.4\n';
const offsets = [0];
for (const [i, obj] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`; }
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
async function upload(name: string, bytes: Uint8Array) {
    const encrypted = encryptBlob(bytes, blobKey);
    const result = await request(`/v1/sessions/${session.id}/attachments/request-upload`, { filename: name, size: encrypted.length });
    assert.equal(result.method, 'PUT');
    const response = await fetch(result.uploadUrl, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' }, body: Buffer.from(encrypted) });
    assert.ok(response.ok, `Upload: ${response.status}`);
    const downloaded = await request(`/v1/sessions/${session.id}/attachments/request-download`, { ref: result.ref });
    const raw = new Uint8Array(await (await fetch(downloaded.downloadUrl, { headers: { Authorization: `Bearer ${token}` } })).arrayBuffer());
    assert.deepEqual(Buffer.from(decryptBlob(raw, blobKey)!), Buffer.from(bytes));
    return result.ref;
}
const imageRef = await upload('generated-preview.png', image);
const pdfRef = await upload('report.pdf', Buffer.from(pdf));
const textBytes = Buffer.from('Opened and decrypted from Talos chat.\n');
const textRef = await upload('notes.txt', textBytes);
const zipRef = await upload('data.bin', new Uint8Array([0, 1, 2, 254, 255]));
const missingRef = `sessions/${session.id}/attachments/missing.png`;
const events = [
    { t: 'text', text: 'Here are the generated image and files. Tap any preview to open it.' },
    { t: 'file', name: 'generated-preview.png', ref: imageRef, mimeType: 'image/png', size: image.length, image: { width: 1200, height: 800, thumbhash: '' } },
    { t: 'file', name: 'report.pdf', ref: pdfRef, mimeType: 'application/pdf', size: Buffer.byteLength(pdf) },
    { t: 'file', name: 'notes.txt', ref: textRef, mimeType: 'text/plain', size: textBytes.length },
    { t: 'file', name: 'data.bin', ref: zipRef, mimeType: 'application/octet-stream', size: 5 },
    { t: 'file', name: 'legacy-preview.png', ref: imageRef, size: image.length, image: { width: 1200, height: 800, thumbhash: '' } },
    { t: 'file', name: 'retry-image.png', ref: missingRef, mimeType: 'image/png', size: image.length, image: { width: 1200, height: 800, thumbhash: '' } },
    { t: 'file', name: 'retry-file.pdf', ref: `sessions/${session.id}/attachments/missing.pdf`, mimeType: 'application/pdf', size: Buffer.byteLength(pdf) },
];
await request(`/v3/sessions/${session.id}/messages`, { messages: events.map(ev => ({ localId: randomUUID(), content: encrypt({ role: 'session', content: { id: randomUUID(), time: Date.now(), role: 'agent', turn: 'attachment-e2e', ev }, meta: { sentFrom: 'cli' } }) })) });
const authScript = `localStorage.setItem('auth_credentials', ${JSON.stringify(JSON.stringify({ token, secret: secret.toString('base64') }))}); location.href = '/session/${session.id}';`;
await writeFile(path.join(directory, 'cli/home/access.key'), JSON.stringify({ token, secret: secret.toString('base64') }), { mode: 0o600 });
await writeFile(path.join(directory, 'browser-auth.js'), authScript, { mode: 0o600 });
await mkdir(path.join(directory, 'fixtures'), { recursive: true });
await writeFile(path.join(directory, 'fixtures/image.encrypted'), encryptBlob(image, blobKey));
await writeFile(path.join(directory, 'fixtures/report.encrypted'), encryptBlob(Buffer.from(pdf), blobKey));
const fixture = { environment, directory, serverUrl, webUrl, sessionId: session.id, imageRef, pdfRef, missingRef, encryptedRoundTrips: 4 };
await writeFile(path.join(directory, 'attachments-fixture.json'), JSON.stringify(fixture, null, 2));
console.log(JSON.stringify(fixture, null, 2));
