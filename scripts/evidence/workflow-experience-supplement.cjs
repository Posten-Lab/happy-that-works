// Responsive, theme and real launch-error checks. Uses the fixture created by workflow-experience.cjs.
// Never starts a valid workflow or modifies the saved library.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
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
    const errors = [], results = {};
    try {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
        await context.addInitScript(({ auth, web }) => { if (location.origin === web) { localStorage.setItem('auth_credentials', JSON.stringify(auth)); localStorage.setItem('mmkv.default\\local-settings', JSON.stringify({ themePreference: 'dark' })); } }, { auth, web });
        const page = await context.newPage(); page.setDefaultTimeout(60000);
        page.on('pageerror', e => errors.push(e.message));
        const button = name => page.getByRole('button', { name, exact: true });
        const input = name => page.getByRole('textbox', { name, exact: true });
        const shot = async name => { await page.waitForTimeout(600); await page.screenshot({ path: path.join(out, name + '.png') }); console.log('Captured', name); };
        await page.goto(web + '/workflows'); await button('Run ' + state.workflowName).waitFor();
        await page.setViewportSize({ width: 320, height: 720 });
        const runBounds = await button('Run ' + state.workflowName).boundingBox();
        assert(runBounds && runBounds.x >= 0 && runBounds.x + runBounds.width <= 320);
        await shot('48-library-narrow'); results.narrowLibraryRunActionFits = true;
        await page.setViewportSize({ width: 390, height: 844 });
        await button('Run ' + state.workflowName).click(); await input('Workflow task').waitFor();
        await input('Workflow task').fill('A long prompt with detailed context. '.repeat(70));
        await page.waitForTimeout(600);
        const expanded = await input('Workflow task').boundingBox(); assert(expanded.height >= 230);
        await input('Workflow task').fill('Review the project.'); await button('Start workflow').focus(); await page.waitForTimeout(600);
        const shrunk = await input('Workflow task').boundingBox(); assert(shrunk.height <= 160, `Prompt did not shrink: ${shrunk.height}`);
        results.promptGrowsAndShrinks = { expanded: expanded.height, shrunk: shrunk.height };
        await input('Workflow task').fill(state.task);
        await page.getByRole('button', { name: /^Project:/ }).click(); await input('Project directory').fill(state.source); await button('Use this project').click();
        await page.setViewportSize({ width: 1440, height: 1000 }); await page.waitForTimeout(600);
        const startBounds = await button('Start workflow').boundingBox(); assert(startBounds.width <= 245);
        await shot('23-launch-desktop'); results.desktopStartWidth = startBounds.width;
        await page.setViewportSize({ width: 390, height: 844 });
        const notGit = fs.mkdtempSync('/tmp/talos-workflow-not-git-');
        await page.getByRole('button', { name: /^Project:/ }).click(); await input('Project directory').fill(notGit); await button('Use this project').click();
        await button('Start workflow').click(); await page.getByText('Needs your attention', { exact: true }).waitFor();
        await button('Start workflow').waitFor();
        const alert = await page.getByRole('alert').innerText();
        assert(/Git project|Git repository/i.test(alert), alert); assert(!/stack trace|Error:|ENOENT/.test(alert), alert);
        await shot('49-launch-project-error'); results.actualInvalidProjectRejected = true; results.errorMessage = alert;
        await page.getByRole('button', { name: /^Project:/ }).click(); await input('Project directory').fill(state.source); await button('Use this project').click();
        await page.evaluate(() => localStorage.setItem('mmkv.default\\local-settings', JSON.stringify({ themePreference: 'light' })));
        // Init scripts set the initial theme; replace it in a new light-theme context.
        const light = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
        await light.addInitScript(({ auth, web }) => { if (location.origin === web) { localStorage.setItem('auth_credentials', JSON.stringify(auth)); localStorage.setItem('mmkv.default\\local-settings', JSON.stringify({ themePreference: 'light' })); } }, { auth, web });
        const lp = await light.newPage(); lp.on('pageerror', e => errors.push(e.message));
        await lp.goto(web + '/workflows'); await lp.getByRole('button', { name: 'Run ' + state.workflowName, exact: true }).waitFor(); await lp.screenshot({ path: path.join(out, '50-library-light.png') });
        await lp.getByRole('button', { name: 'Run ' + state.workflowName, exact: true }).click(); await lp.getByRole('textbox', { name: 'Workflow task', exact: true }).fill(state.task);
        await lp.getByRole('button', { name: /^Project:/ }).click(); await lp.getByRole('textbox', { name: 'Project directory', exact: true }).fill(state.source); await lp.getByRole('button', { name: 'Use this project', exact: true }).click(); await lp.waitForTimeout(600); await lp.screenshot({ path: path.join(out, '51-launch-light.png') });
        results.lightThemeLibraryAndLaunch = true;
        assert.deepEqual(errors, []);
        fs.writeFileSync(path.join(out, 'supplement-validation.json'), JSON.stringify({ ...results, pageErrors: errors, validatedAt: new Date().toISOString() }, null, 2) + '\n');
        console.log(JSON.stringify(results));
    } finally { await browser.close(); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
