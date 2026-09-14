// Actual start-status RPC against a completed isolated run, plus device-storage failure injection.
// No additional provider turns are started by this validation.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

async function main() {
    const envDir = process.env.WORKFLOW_E2E_ENV;
    assert(envDir?.includes('/environments/data/envs/'), 'Use an isolated Talos environment');
    const env = JSON.parse(fs.readFileSync(path.join(envDir, 'environment.json')));
    const web = `http://localhost:${env.expoPort}`;
    const auth = JSON.parse(fs.readFileSync(path.join(envDir, 'cli/home/access.key')));
    const result = JSON.parse(fs.readFileSync('/tmp/talos-workflow-launch-result.json'));
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        await context.addInitScript(({ origin, credentials }) => { if (location.origin === origin) localStorage.setItem('auth_credentials', JSON.stringify(credentials)); }, { origin: web, credentials: auth });
        const page = await context.newPage();
        const startFrames = [];
        page.on('websocket', socket => socket.on('framesent', frame => { if (/workflow-start-v[23]["']/u.test(String(frame.payload))) startFrames.push(true); }));
        const launchURL = web + '/workflows/run?workflowId=' + result.workflowId;
        await page.goto(launchURL);
        await page.getByRole('textbox', { name: 'Workflow task', exact: true }).waitFor({ timeout: 30000 });
        const receiptKey = 'mmkv.default\\pending-workflow-start-v1';
        await page.evaluate(({ key, receipt }) => localStorage.setItem(key, JSON.stringify(receipt)), { key: receiptKey, receipt: { id: result.runId, machineId: result.machineId } });
        await page.reload();
        await page.getByRole('button', { name: 'Check start status', exact: true }).click();
        await page.waitForURL(new RegExp('/workflows/' + result.runId + '\\?machineId='), { timeout: 30000 });
        assert.equal(await page.evaluate(key => localStorage.getItem(key), receiptKey), null);
        await page.getByText('Every required approval and check passed', { exact: true }).waitFor();
        await page.goto(launchURL);
        await page.getByRole('textbox', { name: 'Workflow task', exact: true }).waitFor();
        await page.evaluate(({ key, receipt }) => localStorage.setItem(key, JSON.stringify(receipt)), { key: receiptKey, receipt: { id: randomUUID(), machineId: result.machineId } });
        await page.reload();
        await page.getByRole('button', { name: 'Check start status', exact: true }).click();
        await page.getByText('No workflow was started. You can update the details and try again.', { exact: true }).waitFor();
        assert.equal(await page.evaluate(key => localStorage.getItem(key), receiptKey), null);
        await page.getByRole('textbox', { name: 'Workflow task', exact: true }).fill('Validate the launch receipt before sending any request.');
        await page.getByRole('button', { name: /^Project:/ }).click();
        await page.getByRole('textbox', { name: 'Project directory', exact: true }).fill('/tmp/talos-missing-launch-fixture');
        await page.getByRole('button', { name: 'Use this project', exact: true }).click();
        await page.evaluate(key => {
            const original = Storage.prototype.setItem;
            window.restoreReceiptStorage = () => { Storage.prototype.setItem = original; };
            Storage.prototype.setItem = function (name, value) { if (name === key) throw new Error('Injected device storage failure'); return original.call(this, name, value); };
        }, receiptKey);
        await page.getByRole('button', { name: 'Start workflow', exact: true }).click();
        await page.getByText('Talos could not save this start request on your device.', { exact: false }).waitFor();
        assert.equal(startFrames.length, 0, 'A receipt must be saved before a start is sent');
        await page.evaluate(() => window.restoreReceiptStorage());
        await page.getByRole('button', { name: 'Start workflow', exact: true }).click();
        await page.getByText('The project folder could not be found on this machine.', { exact: false }).waitFor({ timeout: 60000 });
        assert.equal(startFrames.length, 1, 'The restored storage permits exactly one start attempt');
        assert.equal(await page.evaluate(key => localStorage.getItem(key), receiptKey), null);
        await page.getByRole('button', { name: /^Project:/ }).click();
        await page.getByRole('textbox', { name: 'Project directory', exact: true }).fill(result.source);
        await page.getByRole('button', { name: 'Use this project', exact: true }).click();
        await page.waitForTimeout(700); // Native-style modal close animation must settle before capture.
        await page.screenshot({ path: 'docs/evidence/workflow-wizard/launch-ready.png' });
        const summary = { actualCreatedReceiptRecovered: true, actualAbsentReceiptUnlocked: true, storageFailurePreventedRPC: true, restoredStorageSentExactlyOneRequest: true, invalidDirectoryExplainedAndUnlocked: true, additionalProviderTurns: 0 };
        fs.writeFileSync('docs/evidence/workflow-wizard/launch-recovery-validation.json', JSON.stringify(summary, null, 2) + '\n');
        console.log(JSON.stringify(summary));
    } finally { await browser.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
