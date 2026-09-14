// Check the shared regular-session picker and draft isolation using the real app.
// Run after workflow-launch.cjs, which creates the isolated fixture and private result receipt.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

async function main() {
    const envDir = process.env.WORKFLOW_E2E_ENV;
    assert(envDir?.includes('/environments/data/envs/'), 'Use an isolated Talos environment');
    const env = JSON.parse(fs.readFileSync(path.join(envDir, 'environment.json')));
    const web = `http://localhost:${env.expoPort}`;
    const auth = JSON.parse(fs.readFileSync(path.join(envDir, 'cli/home/access.key')));
    const result = JSON.parse(fs.readFileSync(process.env.WORKFLOW_LAUNCH_RESULT || '/tmp/talos-workflow-launch-result.json'));
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await context.addInitScript(({ origin, credentials }) => { if (location.origin === origin) localStorage.setItem('auth_credentials', JSON.stringify(credentials)); }, { origin: web, credentials: auth });
        const page = await context.newPage();
        await page.goto(web + '/new');
        const prompt = page.getByPlaceholder('What would you like to work on?');
        await prompt.waitFor({ timeout: 30000 });
        await prompt.fill('Unsent regular session draft must survive workflow configuration.');
        await page.getByText(/^~?\/.*workflow-worktrees\//).first().click();
        await page.getByRole('textbox', { name: 'Project directory', exact: true }).fill('/tmp/regular-session-draft-project');
        await page.screenshot({ path: 'docs/evidence/workflow-wizard/shared-regular-session-picker.png' });
        await prompt.click();
        await page.goto(web + '/workflows/run?workflowId=' + result.workflowId);
        await page.getByRole('textbox', { name: 'Workflow task', exact: true }).fill('Independent workflow draft');
        await page.getByRole('button', { name: /^Project:/ }).click();
        await page.getByRole('textbox', { name: 'Project directory', exact: true }).fill('/tmp/workflow-only-project');
        await page.getByRole('button', { name: 'Use this project', exact: true }).click();
        await page.goto(web + '/new');
        await prompt.waitFor();
        assert.equal(await prompt.inputValue(), 'Unsent regular session draft must survive workflow configuration.');
        await page.getByText('/tmp/regular-session-draft-project', { exact: true }).waitFor();
        console.log(JSON.stringify({ regularSessionSharedPicker: true, regularSessionPromptPreserved: true, regularSessionProjectPreserved: true, workflowDraftIsolated: true }));
    } finally { await browser.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
