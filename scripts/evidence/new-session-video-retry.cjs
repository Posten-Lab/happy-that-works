/** Usage: TALOS_E2E_PLAYWRIGHT=<package path> node scripts/evidence/new-session-video-retry.cjs <env dir> <CDP URL> <video path> */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.TALOS_E2E_PLAYWRIGHT || 'playwright');
(async () => {
    const [directory, cdpUrl, videoPath] = process.argv.slice(2);
    const config = JSON.parse(fs.readFileSync(path.join(directory, 'environment.json')));
    const { token } = JSON.parse(fs.readFileSync(path.join(directory, 'cli/home/access.key')));
    const serverUrl = `http://localhost:${config.serverPort}`;
    const headers = { Authorization: `Bearer ${token}` };
    const sessions = async () => (await (await fetch(`${serverUrl}/v1/sessions`, { headers })).json()).sessions;
    const before = new Set((await sessions()).map(s => s.id));
    const browser = await chromium.connectOverCDP(cdpUrl);
    const page = browser.contexts()[0].pages().find(p => p.url().includes(`localhost:${config.expoPort}`));
    const endpoint = '**/attachments/request-upload';
    try {
        // The new-session screen should have a connected test machine and Codex selected.
        if (!page.url().endsWith('/new')) await page.goto(`http://localhost:${config.expoPort}/new`);
        const codex = page.getByText('codex', { exact: true });
        if (!(await codex.isVisible())) await page.getByText('claude code', { exact: true }).click();
        await codex.click();
        page.on('filechooser', () => {});
        await page.getByText('\uf2ac', { exact: true }).click();
        await page.locator('input[type="file"]').last().setInputFiles(videoPath);
        await page.getByText(path.basename(videoPath), { exact: true }).waitFor();
        const prompt = 'Reply NEW_SESSION_RETRY_OK to acknowledge this attached video. Do not modify files.';
        await page.getByRole('textbox').fill(prompt);
        await page.route(endpoint, route => route.abort('failed'));
        await page.getByRole('textbox').press('Enter');
        await page.getByText('Upload Failed', { exact: true }).waitFor({ timeout: 60_000 });
        const created = (await sessions()).filter(s => !before.has(s.id));
        assert.equal(created.length, 1);
        const sessionId = created[0].id;
        assert.equal(await page.getByRole('textbox').inputValue(), prompt);
        const pending = await (await fetch(`${serverUrl}/v3/sessions/${sessionId}/messages?after_seq=0&limit=100`, { headers })).json();
        assert.equal(pending.messages.length, 0);
        await page.getByText('OK', { exact: true }).click();
        const toast = page.locator('#error-toast button');
        if (await toast.isVisible()) await toast.click();
        await page.screenshot({ path: 'docs/evidence/busy-video-upload/new-session-retry.png' });
        await page.unroute(endpoint);
        await page.getByRole('textbox').press('Enter');
        await page.waitForURL(`**/session/${sessionId}`, { timeout: 60_000 });
        assert.equal((await sessions()).filter(s => !before.has(s.id)).length, 1);
        await page.getByText('NEW_SESSION_RETRY_OK', { exact: true }).waitFor({ timeout: 60_000 });
        await page.screenshot({ path: 'docs/evidence/busy-video-upload/new-session-retry-complete.png' });
        fs.writeFileSync('docs/evidence/busy-video-upload/new-session-results.json', JSON.stringify({
            sessionsCreated: 1, failedUploadMessagesSent: 0, draftAndAttachmentRetained: true,
            retryReusedSession: true, realCodexReply: 'NEW_SESSION_RETRY_OK',
        }, null, 2) + '\n');
        console.log('PASS: failed first-message upload retained the draft; retry reused the same session and Codex replied.');
    } finally {
        await page.unroute(endpoint);
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
