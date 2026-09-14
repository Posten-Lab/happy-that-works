// Approve and finish an existing isolated run after a participant replacement.
// Uses the app's actual controls; never edits run state or relaxes provider isolation.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

async function main() {
    const envDir = process.env.WORKFLOW_E2E_ENV;
    assert(envDir?.includes('/environments/data/envs/'), 'Use an isolated Talos environment');
    assert(process.env.WORKFLOW_E2E_STATE, 'Set WORKFLOW_E2E_STATE to the existing run receipt');
    const env = JSON.parse(fs.readFileSync(path.join(envDir, 'environment.json')));
    assert.equal(new URL(env.authenticatedWebUrl).hostname, 'localhost');
    const auth = JSON.parse(fs.readFileSync(path.join(envDir, 'cli/home/access.key')));
    const state = JSON.parse(fs.readFileSync(process.env.WORKFLOW_E2E_STATE));
    assert(state.runId && state.machineId && state.source);
    const web = `http://localhost:${env.expoPort}`;
    const out = path.resolve(process.env.WORKFLOW_E2E_OUTPUT || 'docs/evidence/workflow-experience');
    fs.mkdirSync(out, { recursive: true });
    const sourceHead = execFileSync('git', ['-C', state.source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    assert.equal(execFileSync('git', ['-C', state.source, 'status', '--porcelain'], { encoding: 'utf8' }), '');
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    let page;
    try {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
        await context.addInitScript(({ credentials, origin }) => {
            if (location.origin !== origin) return;
            localStorage.setItem('auth_credentials', JSON.stringify(credentials));
            localStorage.setItem('mmkv.default\\local-settings', JSON.stringify({ themePreference: 'dark' }));
        }, { credentials: auth, origin: web });
        page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const button = name => page.getByRole('button', { name, exact: true });
        const shot = name => page.screenshot({ path: path.join(out, `recovery-${name}.png`) });
        await page.goto(`${web}/workflows/${state.runId}?machineId=${state.machineId}`);
        await page.getByRole('tab', { name: 'Plan', exact: true }).waitFor({ timeout: 60000 });
        await shot('replanned');
        let approved = false, visitedExecutorSession = false, complete = false, previous = '';
        const deadline = Date.now() + 15 * 60000;
        while (Date.now() < deadline) {
            const body = await page.locator('body').innerText();
            const status = body.slice(0, 900);
            if (status !== previous) { console.log(JSON.stringify({ at: new Date().toISOString(), status })); previous = status; }
            if (await page.getByText('Every required approval and check passed', { exact: true }).isVisible()) { complete = true; break; }
            if (!approved && await button('Approve agreed plan').isVisible()) {
                await shot('fresh-plan-approval');
                await button('Approve agreed plan').click();
                approved = true;
                console.log('Approved the replacement participant’s fresh plan through the app.');
                await page.waitForTimeout(2000);
                continue;
            }
            const executor = page.getByRole('button', { name: /^Open Atlas session$/ });
            if (approved && !visitedExecutorSession && await executor.isVisible()) {
                await shot('executing');
                await executor.click();
                await page.waitForURL(/\/session\//, { timeout: 30000 });
                await page.waitForTimeout(4000);
                await shot('executor-session');
                visitedExecutorSession = true;
                await page.getByRole('button', { name: /Back to workflow|Open workflow/ }).first().click();
                await page.waitForURL(/\/workflows\//, { timeout: 30000 });
                continue;
            }
            if (approved && await button('Resume run').isVisible()) {
                await shot('needs-input');
                throw new Error('The recovered run needs further input. Inspect the captured actual provider result.');
            }
            await page.waitForTimeout(8000);
        }
        assert(complete, 'Recovered run did not complete within fifteen minutes');
        assert(approved, 'This evidence must include actual approval of the fresh plan');
        assert(visitedExecutorSession, 'The actual replacement executor session was not opened');
        await shot('complete');
        const completedText = await page.locator('body').innerText();
        for (const tab of ['Work', 'Review', 'Activity']) {
            await page.getByRole('tab', { name: tab, exact: true }).click();
            await page.getByRole('tab', { name: tab, exact: true }).scrollIntoViewIfNeeded();
            await page.waitForTimeout(500);
            await shot(tab.toLowerCase());
        }
        await page.getByRole('tab', { name: 'Review', exact: true }).click();
        await page.getByText('Completion checks', { exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }));
        await shot('review-detail');
        const reviewText = await page.locator('body').innerText();
        await page.getByRole('button', { name: /Automated tests: Passed\. Show output/ }).click();
        await shot('checks-output');
        const checksText = await page.locator('body').innerText();
        assert.equal(execFileSync('git', ['-C', state.source, 'status', '--porcelain'], { encoding: 'utf8' }), '');
        assert.equal(execFileSync('git', ['-C', state.source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceHead);
        assert.deepEqual(errors, []);
        const result = { runId: state.runId, completed: true, freshPlanApprovedThroughUI: approved, visitedReplacementExecutorSession: visitedExecutorSession,
            sourceUnchanged: true, pageErrors: errors, completedText, reviewText, checksText, validatedAt: new Date().toISOString(),
            limitation: 'The original Claude executor failed to spawn Bash because its sandbox profile exceeded macOS ARG_MAX. Recovery used a user-visible Codex participant replacement; Claude shell execution is not claimed.' };
        fs.writeFileSync(path.join(out, 'recovery-validation.json'), JSON.stringify(result, null, 2) + '\n');
        console.log(JSON.stringify({ ...result, completedText: undefined, reviewText: undefined, checksText: undefined }));
    } catch (error) {
        if (page) {
            await page.screenshot({ path: path.join(out, 'recovery-failure.png') });
            console.log((await page.locator('body').innerText()).slice(0, 7000));
        }
        throw error;
    } finally { await browser.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
