/**
 * Real server/CLI round trips and browser retry checks for video attachments.
 * Start the isolated server, web app, and a Codex session first (see evidence README).
 * Run with tsx --tsconfig packages/talos-cli/tsconfig.json and arguments:
 *   <environment directory> <session id> <browser CDP URL> <video path>
 * TALOS_E2E_PLAYWRIGHT points to an installed Playwright package (e.g. agent-browser's).
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { decryptLegacy, encryptBlob, encryptLegacy } from '../../packages/talos-cli/src/api/encryption';
import { deriveKey } from '../../packages/talos-cli/src/utils/deriveKey';
import { encryptionContexts, MAX_ENCRYPTED_ATTACHMENT_BYTES } from '../../packages/talos-wire/src/index';

const [environmentDir, sessionId, cdpUrl, videoPath] = process.argv.slice(2);
assert(environmentDir && sessionId && cdpUrl && videoPath);
const config = JSON.parse(await readFile(path.join(environmentDir, 'environment.json'), 'utf8'));
const credentials = JSON.parse(await readFile(path.join(environmentDir, 'cli/home/access.key'), 'utf8'));
const secret = Buffer.from(credentials.secret, 'base64');
const serverUrl = `http://localhost:${config.serverPort}`;
process.env.TALOS_SERVER_URL = serverUrl;
process.env.TALOS_HOME_DIR = path.join(environmentDir, 'cli/home');
const { ApiSessionClient } = await import('../../packages/talos-cli/src/api/apiSession');
const outputDir = path.resolve('docs/evidence/busy-video-upload');
await mkdir(outputDir, { recursive: true });
const headers = { Authorization: `Bearer ${credentials.token}`, 'Content-Type': 'application/json' };
const encrypt = (v: unknown) => Buffer.from(encryptLegacy(v, secret)).toString('base64');
async function request(route: string, body?: unknown) {
    const response = await fetch(serverUrl + route, { method: body === undefined ? 'GET' : 'POST', headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert(response.ok, `${route}: ${response.status}`);
    return response.json();
}
async function userRecords() {
    const messages: any[] = [];
    let seq = 0;
    while (true) {
        const response = await request(`/v3/sessions/${sessionId}/messages?after_seq=${seq}&limit=100`);
        messages.push(...response.messages);
        if (!response.hasMore || response.messages.length === 0) break;
        seq = Math.max(...response.messages.map((m: any) => m.seq));
    }
    return messages.map((m: any) => decryptLegacy(Buffer.from(m.content.c, 'base64'), secret))
        .filter((r: any) => r?.role === 'user' || (r?.role === 'session' && (r.content?.data ?? r.content)?.role === 'user'));
}
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.TALOS_E2E_PLAYWRIGHT || 'playwright');
const browser = await chromium.connectOverCDP(cdpUrl);
const page = browser.contexts()[0].pages().find((p: any) => p.url().includes(`/session/${sessionId}`));
assert(page, 'Open the live session in agent-browser first');
page.on('filechooser', () => {}); // Suppress the OS dialog; set Expo's real file input below.
async function dismissDevToast() {
    const dismiss = page.locator('#error-toast button');
    if (await dismiss.isVisible()) await dismiss.click();
}
await dismissDevToast();
const input = page.getByRole('textbox', { name: 'Type a message ...' });
const video = await readFile(videoPath);
assert(video.length > 10 * 1024 * 1024);
const notePath = path.join(environmentDir, 'retry-note.txt');
await writeFile(notePath, 'Attachment retry regression fixture.\n');
const nextPath = path.join(environmentDir, 'next-message.txt');
await writeFile(nextPath, 'This belongs to the next draft.\n');
async function pickFiles(files: string[]) {
    await page.getByText('\uf2ac', { exact: true }).click(); // document-attach-outline
    // Exercise the input created by Expo's picker (including its change handler).
    await page.locator('input[type="file"]').last().setInputFiles(files);
    await page.getByText(path.basename(files[0]), { exact: true }).last().waitFor();
}
const message = `Retry check ${randomUUID()}: acknowledge the two attached files with RETRY_OK.`;
const before = (await userRecords()).length;
let uploadRequests = 0;
const failures = '**/attachments/request-upload';
await page.route(failures, async (route: any) => {
    uploadRequests++;
    if (uploadRequests === 2) await route.abort('failed');
    else await route.continue();
});
try {
    await pickFiles([videoPath, notePath]);
    await input.fill(message);
    await input.press('Enter');
    await page.getByText('Upload Failed', { exact: true }).waitFor({ timeout: 30_000 });
    assert.equal(await input.inputValue(), message);
    assert.equal((await userRecords()).length, before, 'A failed batch must not send any file or text records');
    console.log('PASS: failed batch preserved the draft and sent no records.');
    await page.waitForTimeout(400); // Let the modal animation settle for the screenshot.
    await page.screenshot({ path: path.join(outputDir, 'upload-failure-preserves-draft.png') });
    await page.getByText('OK', { exact: true }).click();
    await dismissDevToast();
    await page.unroute(failures);

    // Hold a real request before sending it so we can edit during the upload.
    let releaseUpload!: () => void;
    const held = new Promise<void>(resolve => { releaseUpload = resolve; });
    let retryRequests = 0;
    await page.route(failures, async (route: any) => {
        retryRequests++;
        if (retryRequests === 1) await held;
        await route.continue();
    });
    await input.press('Enter');
    await page.getByRole('progressbar').last().waitFor();
    await input.press('Enter'); // duplicate keyboard send while pending
    const nextDraft = 'Keep this text for my next message.';
    await input.fill(nextDraft);
    await pickFiles([nextPath]);
    await page.screenshot({ path: path.join(outputDir, 'upload-in-progress-new-draft.png') });
    releaseUpload();
    await page.waitForFunction(() => document.querySelectorAll('[role="progressbar"]').length === 0, undefined, { timeout: 30_000 });
    await page.unroute(failures);
    const deadline = Date.now() + 10_000;
    let after = await userRecords();
    while (after.length < before + 3 && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 250));
        after = await userRecords();
    }
    assert.equal(after.length, before + 3, 'Retry sends exactly two files and one text record');
    assert.equal(retryRequests, 2, 'Duplicate Send must not upload the files twice');
    assert.equal(await input.inputValue(), nextDraft);
    assert(await page.getByText('next-message.txt', { exact: true }).isVisible());
    await page.screenshot({ path: path.join(outputDir, 'retry-success-preserves-new-draft.png') });
    await writeFile(path.join(outputDir, 'retry-results.json'), JSON.stringify({
        videoBytes: video.length, videoSha256: createHash('sha256').update(video).digest('hex'),
        failedBatchSentRecords: 0, retrySentRecords: after.length - before, retryUploadRequests: retryRequests,
        newerTextPreserved: true, newerAttachmentPreserved: true,
        fault: 'The second request-upload is aborted once; all successful transfers use the actual server.',
    }, null, 2) + '\n');
    console.log('PASS: retry sent the batch once and preserved subsequent edits.');
} finally {
    await page.unroute(failures);
    await browser.close();
}

// Exercise the actual CLI HTTP downloader at the encrypted 100 MiB boundary.
const metadata = { path: '/tmp', host: 'Video size boundary', flavor: 'codex' };
const raw = (await request('/v1/sessions', { tag: randomUUID(), metadata: encrypt(metadata) })).session;
const client = new ApiSessionClient(credentials.token, {
    id: raw.id, seq: raw.seq, metadata, metadataVersion: raw.metadataVersion,
    agentState: null, agentStateVersion: 0, encryptionKey: secret, encryptionVariant: 'legacy',
});
try {
    const original = Buffer.alloc(100 * 1024 * 1024, 0x5a);
    const blobKey = await deriveKey(secret, encryptionContexts.blobs, ['master']);
    const encrypted = encryptBlob(original, blobKey);
    assert.equal(encrypted.length, MAX_ENCRYPTED_ATTACHMENT_BYTES);
    const upload = await request(`/v1/sessions/${raw.id}/attachments/request-upload`, { filename: 'boundary.bin', size: encrypted.length });
    const response = await fetch(upload.uploadUrl, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: Buffer.from(encrypted) });
    assert.equal(response.status, 200);
    const downloaded = await client.downloadAndDecryptAttachment(upload.ref);
    assert(downloaded && Buffer.from(downloaded).equals(original));
    const oversize = await fetch(`${serverUrl}/v1/sessions/${raw.id}/attachments/request-upload`, {
        method: 'POST', headers, body: JSON.stringify({ filename: 'too-large.bin', size: encrypted.length + 1 }),
    });
    assert.equal(oversize.status, 413);
    await writeFile(path.join(outputDir, 'boundary-results.json'), JSON.stringify({
        originalBytes: original.length, encryptedBytes: encrypted.length, localUploadStatus: response.status,
        actualCliDownloadAndDecryptMatched: true, oversizeStatus: oversize.status,
    }, null, 2) + '\n');
} finally {
    await client.close();
}
console.log('PASS: real video retry, draft preservation, duplicate-send guard, and encrypted 100 MiB CLI round trip.');
