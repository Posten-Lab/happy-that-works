// Exercise plan-consensus navigation through the actual UI, then cancel before execution.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const req = createRequire(path.join(process.cwd(), 'packages/talos-app/package.json'));
const nacl = req('tweetnacl');

async function main() {
    const envDir = process.env.WORKFLOW_E2E_ENV;
    assert(envDir?.includes('/environments/data/envs/'), 'Use an isolated Talos environment');
    const env = JSON.parse(fs.readFileSync(path.join(envDir, 'environment.json')));
    assert.equal(new URL(env.authenticatedWebUrl).hostname, 'localhost');
    const auth = JSON.parse(fs.readFileSync(path.join(envDir, 'cli/home/access.key')));
    const state = JSON.parse(fs.readFileSync(process.env.WORKFLOW_E2E_STATE || '/tmp/talos-workflow-experience.json'));
    const source = JSON.parse(fs.readFileSync(process.env.WORKFLOW_E2E_SOURCE_STATE || process.env.WORKFLOW_E2E_STATE || '/tmp/talos-workflow-experience.json')).source;
    const web = `http://localhost:${env.expoPort}`;
    const response = await fetch(`http://localhost:${env.serverPort}/v1/account/settings`, { headers: { Authorization: `Bearer ${auth.token}` } });
    assert(response.ok);
    const account = await response.json(), encrypted = Buffer.from(account.settings, 'base64');
    const plain = nacl.secretbox.open(encrypted.subarray(24), encrypted.subarray(0, 24), Buffer.from(auth.secret, 'base64'));
    assert(plain);
    const settings = JSON.parse(Buffer.from(plain).toString());
    const definition = [...(settings.workflowLibrary || []), ...(settings.workflowLibraryV2 || []), ...(settings.workflowLibraryV3 || [])].find(item => item.id === state.workflowId);
    assert(definition?.approvePlan, 'This saved workflow must require human approval before execution');
    const sourceHead = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    assert.equal(execFileSync('git', ['-C', source, 'status', '--porcelain'], { encoding: 'utf8' }), '');
    const out = path.resolve('docs/evidence/workflow-experience');
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    let page, runId, cancelled = false;
    async function cancel() {
        const button = name => page.getByRole('button', { name, exact: true });
        if (await button('Run controls').isVisible()) await button('Run controls').click();
        await button('Cancel run').click();
        await page.getByText('Cancel this run?', { exact: true }).waitFor();
        // The shared web confirmation currently exposes its visible label as text.
        await page.getByText('OK', { exact: true }).click();
        await page.getByText('Run stopped', { exact: true }).waitFor({ timeout: 60000 });
        cancelled = true;
    }
    try {
        const c = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
        await c.addInitScript(({ credentials, origin }) => {
            if (location.origin !== origin) return;
            localStorage.setItem('auth_credentials', JSON.stringify(credentials));
            localStorage.setItem('mmkv.default\\local-settings', JSON.stringify({ themePreference: 'dark' }));
        }, { credentials: auth, origin: web });
        page = await c.newPage();
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        const button = name => page.getByRole('button', { name, exact: true });
        if (process.env.WORKFLOW_E2E_EXISTING_RUN) {
            runId = process.env.WORKFLOW_E2E_EXISTING_RUN;
            await page.goto(`${web}/workflows/${runId}?machineId=${state.machineId}`);
            await page.getByRole('tab', { name: 'Plan', exact: true }).waitFor({ timeout: 60000 });
        } else {
            await page.goto(`${web}/workflows/run?workflowId=${state.workflowId}`);
            await page.getByRole('textbox', { name: 'Workflow task', exact: true }).waitFor({ timeout: 60000 });
            await page.getByRole('textbox', { name: 'Workflow task', exact: true }).fill('Add one README sentence explaining that the sample CLI is dependency-free and uses Node.js built-ins. Keep source code unchanged. This is a small documentation-only change.');
            await page.getByRole('button', { name: /^Project:/ }).click();
            await page.getByRole('textbox', { name: 'Project directory', exact: true }).fill(source);
            await button('Use this project').click();
            await button('Start workflow').click();
            await page.waitForURL(/\/workflows\/[0-9a-f-]{36}\?machineId=/, { timeout: 180000 });
            runId = new URL(page.url()).pathname.split('/').pop();
        }
        console.log(JSON.stringify({ planningGateRun: runId }));
        const deadline = Date.now() + 8 * 60000;
        while (!(await button('Approve agreed plan').isVisible()) && Date.now() < deadline) {
            console.log(JSON.stringify({ at: new Date().toISOString(), status: (await page.locator('body').innerText()).slice(0, 900) }));
            if (await button('Resume run').isVisible()) throw new Error('Planning requires unexpected user guidance');
            await page.waitForTimeout(12000);
        }
        assert(await button('Approve agreed plan').isVisible(), 'Planning consensus exceeded eight minutes');
        await page.screenshot({ path: path.join(out, '54-plan-approval-final.png') });
        await button('Read agreed plan').click();
        await page.waitForTimeout(900);
        assert.equal(await page.getByRole('tab', { name: 'Plan', exact: true }).getAttribute('aria-selected'), 'true');
        const heading = page.getByText('Plan · v1', { exact: true });
        const box = await heading.boundingBox();
        assert(box && box.y >= 56 && box.y <= 200, `Plan header must be near the top after the anchor: ${JSON.stringify(box)}`);
        await page.screenshot({ path: path.join(out, '55-plan-anchor.png') });
        await cancel();
        await page.getByText('WORKFLOW RUN', { exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }));
        await page.screenshot({ path: path.join(out, '56-plan-gate-cancelled.png') });
        assert.equal(execFileSync('git', ['-C', source, 'status', '--porcelain'], { encoding: 'utf8' }), '');
        assert.equal(execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceHead);
        assert.deepEqual(errors, []);
        const result = { runId, realPlanningConsensus: true, agreedPlanAnchorClicked: true, planTabSelected: true, planHeadingTop: box.y,
            cancelledThroughUI: cancelled, executionNeverApproved: true, sourceUnchanged: true, pageErrors: errors, validatedAt: new Date().toISOString() };
        fs.writeFileSync(path.join(out, 'gate-validation.json'), JSON.stringify(result, null, 2) + '\n');
        console.log(JSON.stringify(result));
    } catch (error) {
        if (page) await page.screenshot({ path: path.join(out, 'gate-failure.png') });
        throw error;
    } finally {
        if (runId && !cancelled) { try { await cancel(); console.log('Cancelled the extra gate run during cleanup.'); } catch (error) { console.error(`Gate cleanup requires attention: ${error.message}`); } }
        await browser.close();
    }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
