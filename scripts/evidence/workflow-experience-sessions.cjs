// Inspect real participant transcripts after the walkthrough; no new tasks or state injection.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
async function main() {
    const envDir = process.env.WORKFLOW_E2E_ENV;
    assert(envDir?.includes('/environments/data/envs/'), 'Use an isolated Talos environment');
    const env = JSON.parse(fs.readFileSync(path.join(envDir, 'environment.json')));
    assert.equal(new URL(env.authenticatedWebUrl).hostname, 'localhost');
    const auth = JSON.parse(fs.readFileSync(path.join(envDir, 'cli/home/access.key')));
    const state = JSON.parse(fs.readFileSync(process.env.WORKFLOW_E2E_STATE || '/tmp/talos-workflow-experience.json'));
    const web = `http://localhost:${env.expoPort}`, out = path.resolve('docs/evidence/workflow-experience');
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
        await context.addInitScript(({ auth, web }) => { if (location.origin === web) { localStorage.setItem('auth_credentials', JSON.stringify(auth)); localStorage.setItem('mmkv.default\\local-settings', JSON.stringify({ themePreference: 'dark' })); } }, { auth, web });
        const page = await context.newPage(); page.setDefaultTimeout(60000);
        const errors = []; page.on('pageerror', e => errors.push(e.message));
        page.on('console', message => { if (message.type() === 'error' && /git status/i.test(message.text())) errors.push(message.text()); });
        await page.goto(`${web}/workflows/${state.runId}?machineId=${state.machineId}`);
        await page.getByRole('tab', { name: 'Work', exact: true }).click();
        await page.getByRole('button', { name: /^Open execution session round/ }).first().click(); await page.waitForURL(/\/session\//);
        await page.getByRole('button', { name: 'Back to workflow', exact: true }).waitFor(); await page.waitForTimeout(3000);
        await page.screenshot({ path: path.join(out, '29-executor-session.png') });
        const responses = page.getByText('Agent response', { exact: true }); assert(await responses.count() > 0, 'Expected a readable structured response');
        assert.equal(await page.getByText('Needs information', { exact: true }).count(), 0);
        const assignment = page.getByText('Assigned task', { exact: true });
        if (await assignment.count()) {
            await assignment.evaluate(e => e.scrollIntoView({ block: 'start' })); await page.waitForTimeout(500);
            await page.screenshot({ path: path.join(out, '57-executor-assignment.png') });
        }
        assert.equal(await page.getByPlaceholder('Ask a follow-up...').count(), 0);
        await page.getByRole('button', { name: 'Back to workflow', exact: true }).click(); await page.waitForURL(/\/workflows\//);
        await page.waitForTimeout(35000); // Exceed the closed-participant Git RPC timeout; no polling error may surface.
        assert.deepEqual(errors, []);
        fs.writeFileSync(path.join(out, 'session-validation.json'), JSON.stringify({ runId: state.runId, openedActualExecutorTranscript: true, readableStructuredResponse: true,
            noSynthesizedNeedsInformationStatus: true, returnedToWorkflow: true, noClosedParticipantGitPollingErrorAfter35Seconds: true, pageErrors: errors, capturedAt: new Date().toISOString(),
            note: 'This transcript was reopened after the execution step. The separate recovery-executor-session frame was captured while its replacement executor was active.' }, null, 2) + '\n');
    } finally { await browser.close(); }
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
