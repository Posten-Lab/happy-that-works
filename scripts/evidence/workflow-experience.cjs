// Full product walkthrough against an isolated local account and actual provider processes.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { createRequire } = require('node:module');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const req = createRequire(path.join(process.cwd(), 'packages/talos-app/package.json'));
const nacl = req('tweetnacl');
const envDir = process.env.WORKFLOW_E2E_ENV;
assert(envDir?.includes('/environments/data/envs/'), 'Use an isolated Talos environment');
const env = JSON.parse(fs.readFileSync(path.join(envDir, 'environment.json')));
assert.equal(new URL(env.authenticatedWebUrl).hostname, 'localhost');
const auth = JSON.parse(fs.readFileSync(path.join(envDir, 'cli/home/access.key')));
const web = `http://localhost:${env.expoPort}`, api = `http://localhost:${env.serverPort}`;
const out = path.resolve('docs/evidence/workflow-experience');
const statePath = process.env.WORKFLOW_E2E_STATE || '/tmp/talos-workflow-experience.json';
const workflowName = 'Feature delivery';
const task = 'Add a workspace readiness report to this sample CLI. It should show the project name and whether package.json and README.md exist, support --json, and pass node --test. Keep the implementation dependency-free, add meaningful automated tests, and document usage.';
fs.mkdirSync(out, { recursive: true });
const secret = Buffer.from(auth.secret, 'base64');
const decode = encrypted => { if (!encrypted) return {}; const b = Buffer.from(encrypted, 'base64'); const plain = nacl.secretbox.open(b.subarray(24), b.subarray(0, 24), secret); assert(plain); return JSON.parse(Buffer.from(plain).toString()); };
async function settings() { const r = await fetch(api + '/v1/account/settings', { headers: { Authorization: 'Bearer ' + auth.token } }); assert(r.ok); const v = await r.json(); return { ...v, plain: decode(v.settings) }; }
async function resetFixtureLibrary() {
    for (let i = 0; i < 5; i++) {
        const current = await settings();
        fs.writeFileSync(statePath + '.settings-backup', JSON.stringify(current.plain), { mode: 0o600 });
        const next = { ...current.plain, experiments: true, expWorkflows: true, expAgentLibrary: true, workflowLibrary: [], workflowLibraryV2: [], workflowLibraryV3: [], agentLibrary: [], agentLibraryV2: [] };
        const nonce = randomBytes(24), encrypted = Buffer.concat([nonce, Buffer.from(nacl.secretbox(Buffer.from(JSON.stringify(next)), nonce, secret))]).toString('base64');
        const r = await fetch(api + '/v1/account/settings', { method: 'POST', headers: { Authorization: 'Bearer ' + auth.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: encrypted, expectedVersion: current.settingsVersion }) }); assert(r.ok); if ((await r.json()).success) return;
    }
    throw new Error('Fixture settings changed concurrently');
}
function createProject() {
    const source = fs.mkdtempSync('/tmp/talos-readiness-');
    fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: 'workspace-check', private: true, version: '1.0.0', scripts: { test: 'node --test', start: 'node cli.js' } }, null, 2) + '\n');
    fs.writeFileSync(path.join(source, 'README.md'), '# Workspace Check\n\nA small dependency-free CLI for project readiness.\n');
    fs.writeFileSync(path.join(source, 'cli.js'), "console.log('Workspace Check');\n");
    execFileSync('git', ['init', '-q', source]); execFileSync('git', ['-C', source, 'add', '.']);
    execFileSync('git', ['-C', source, '-c', 'user.name=Talos E2E', '-c', 'user.email=e2e@example.invalid', 'commit', '-qm', 'Create readiness CLI fixture']);
    return source;
}
async function main() {
    const phase = process.env.WORKFLOW_E2E_PHASE || 'all';
    if (phase === 'all' || phase === 'create') await resetFixtureLibrary();
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
    await context.addInitScript(({ auth, origin }) => { if (location.origin === origin) { localStorage.setItem('auth_credentials', JSON.stringify(auth)); localStorage.setItem('mmkv.default\\local-settings', JSON.stringify({ themePreference: 'dark' })); } }, { auth, origin: web });
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && /Unexpected text node|Text strings must|Maximum update depth|git status/.test(m.text())) errors.push(m.text()); });
    const button = name => page.getByRole('button', { name, exact: true });
    const input = name => page.getByRole('textbox', { name, exact: true });
    const scroll = async end => {
        const position = await page.evaluate(end => {
            const candidates = [...document.querySelectorAll('div')].filter(e => { const r = e.getBoundingClientRect(), css = getComputedStyle(e); return !e.closest('[aria-hidden="true"]') && r.top < innerHeight && r.bottom > 0 && r.height > 200 && r.width > 250 && ['auto', 'scroll'].includes(css.overflowY) && e.scrollHeight > e.clientHeight + 10; });
            const e = candidates.sort((a, b) => b.clientHeight - a.clientHeight)[0];
            if (!e) return null;
            const target = end ? e.scrollHeight - e.clientHeight : 0;
            // RN Web replaces element.scrollTo with its {x,y,animated} API; DOM {top} is ignored.
            e.scrollTop = target;
            return { target, actual: e.scrollTop };
        }, end);
        if (position) assert(Math.abs(position.target - position.actual) <= 2, `Scroll did not reach ${position.target}`);
        await page.waitForTimeout(400);
    };
    const shot = async (name, end = false) => { await scroll(end); await page.waitForTimeout(400); await page.screenshot({ path: path.join(out, name + '.png') }); console.log('Captured', name); };
    let state;
    try {
        if (phase === 'all' || phase === 'create') {
            await page.goto(web + '/workflows'); await button('Create workflow').waitFor({ timeout: 60000 }); await shot('01-library-empty');
            await button('Create workflow').click(); await input('Workflow name').fill(workflowName); await input('Description (optional)').fill('Plan, implement and independently review changes to a software project.'); await shot('02-wizard-basics');
            await button('Continue').click(); await button('Add planner to step 1').waitFor(); await shot('03-wizard-team-empty');
            for (const [role, step, name, provider, model] of [['planner', 1, 'Ada', 'Claude', null], ['executor', 2, 'Atlas', 'Codex', 'GPT-5.6-Sol'], ['reviewer', 3, 'Vega', 'Muse Code', null]]) {
                await button(`Add ${role} to step ${step}`).click(); if (step === 1) await shot('04-agent-picker');
                await button('Create new agent').click(); await input('Agent name').fill(name);
                await page.getByRole('button', { name: /^Provider:/ }).click(); if (step === 1) await shot('05-provider-selection'); await page.getByRole('radio', { name: provider, exact: true }).click();
                await page.getByRole('button', { name: /^Model:/ }).click({ timeout: 60000 });
                await shot(`06-model-selection-${provider === 'Muse Code' ? 'muse' : provider.toLowerCase()}`);
                const target = model ? page.getByRole('radio', { name: model, exact: true }) : page.getByRole('radio').filter({ hasText: provider === 'Claude' ? /Sonnet/i : /Default|default/ }).first();
                if (await target.count()) await target.click(); else await page.getByRole('radio').first().click();
                const effort = page.getByRole('button', { name: /^Effort:/ });
                if (await effort.isEnabled()) { await effort.click(); if (step === 1) await shot('07-effort-selection'); const low = page.getByRole('radio', { name: 'low', exact: true }); if (await low.count()) await low.click(); else await page.getByRole('radio').first().click(); }
                await input('Agent description').fill(step === 1 ? 'Turns a task into a precise, testable plan.' : step === 2 ? 'Builds small, maintainable changes and verifies the result.' : 'Independently checks correctness, usability and tests.');
                await input('Agent instructions').fill('Read the project before deciding. Keep the solution small and dependency-free. Verify claims using actual files and commands. Do not delegate. Return the requested workflow decision JSON.');
                await shot(`08-agent-configuration-${provider === 'Muse Code' ? 'muse' : provider.toLowerCase()}`); if (step === 1) await shot('09-agent-instructions', true);
                await button('Use this agent').click(); await button(`Edit ${name} in step ${step}`).waitFor();
            }
            await shot('10-wizard-team'); await shot('11-wizard-team-lower', true);
            await button('Customize step 1').click(); await shot('12-stage-settings'); await shot('12-stage-settings-lower', true); await button('Hide step 1').click();
            await button('Continue').click(); await input('Completion criteria').fill('The requested behavior works, usage is documented, and meaningful automated tests pass. Every reviewer approves the same project revision.');
            await input('Check 1 name').fill('Automated tests'); await input('Check 1 command').fill('node --test');
            const approval = page.getByRole('switch'); if (await approval.count()) { if (!(await approval.first().isChecked())) await approval.first().click(); }
            await shot('13-wizard-finish'); await shot('14-wizard-finish-lower', true);
            await button('Review workflow').click(); await button('Save workflow').waitFor(); await shot('15-wizard-review'); await shot('16-wizard-review-lower', true);
            await button('Save workflow').click(); await button(`Run ${workflowName}`).waitFor(); await shot('17-library-saved');
            await page.setViewportSize({ width: 1440, height: 1000 }); await shot('18-library-desktop'); await page.setViewportSize({ width: 390, height: 844 });
            const saved = (await settings()).plain; const definition = [...(saved.workflowLibrary || []), ...(saved.workflowLibraryV2 || []), ...(saved.workflowLibraryV3 || [])].find(w => w.name === workflowName); assert(definition); assert.equal(definition.approvePlan, true);
            state = { workflowId: definition.id, source: createProject(), task, workflowName, createdThroughUI: true };
            fs.writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
            assert.deepEqual(errors, []); console.log(JSON.stringify({ createdThroughUI: true, workflowId: state.workflowId }));
            if (phase === 'create') return;
        } else state = JSON.parse(fs.readFileSync(statePath));
        if (phase !== 'results') {
        await page.goto(web + '/workflows/run?workflowId=' + state.workflowId); await input('Workflow task').waitFor({ timeout: 60000 }); await input('Workflow task').fill(task);
        await page.getByRole('button', { name: /^Machine:/ }).click(); await shot('19-launch-machine-picker'); await button('Close machine picker').click();
        await page.getByRole('button', { name: /^Project:/ }).click(); await input('Project directory').fill(state.source); await shot('20-launch-project-picker'); await button('Use this project').click();
        await shot('21-launch'); await shot('22-launch-team', true);
        await page.setViewportSize({ width: 1440, height: 1000 }); await shot('23-launch-desktop'); await page.setViewportSize({ width: 390, height: 844 });
        await button('Start workflow').click(); await page.waitForURL(/\/workflows\/[0-9a-f-]{36}\?machineId=/, { timeout: 180000 });
        const runURL = page.url(); Object.assign(state, { startedThroughUI: true, runId: new URL(runURL).pathname.split('/').pop(), machineId: new URL(runURL).searchParams.get('machineId') }); fs.writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 }); console.log(JSON.stringify({ startedThroughUI: true, runId: state.runId }));
        // Remaining capture steps deliberately use real UI states; no run status is injected.
        const sessionButton = () => page.getByRole('button', { name: /Open .* session|Inspect .* session/ }).first();
        await sessionButton().waitFor({ timeout: 180000 }); await shot('24-run-planning');
        await sessionButton().click(); await page.waitForURL(/\/session\//); await page.waitForTimeout(7000); await shot('25-planner-session'); state.visitedLivePlannerSession = true; fs.writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
        await page.getByRole('button', { name: /Back to workflow|Open workflow/ }).first().click(); await page.waitForURL(/\/workflows\//);
        await button('Approve agreed plan').waitFor({ timeout: 8 * 60000 }); await shot('26-run-awaiting-approval'); await shot('27-agreed-plan', true);
        await button('Approve agreed plan').click(); state.manualPlanApproval = true; fs.writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
        await page.getByRole('button', { name: /Open Atlas session|Inspect Atlas session/ }).waitFor({ timeout: 180000 }); await shot('28-run-executing');
        await page.getByRole('button', { name: /Open Atlas session|Inspect Atlas session/ }).click(); await page.waitForURL(/\/session\//); await page.waitForTimeout(10000); await shot('29-executor-session'); state.visitedLiveExecutorSession = true; fs.writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
        await page.getByRole('button', { name: /Back to workflow|Open workflow/ }).first().click(); await page.waitForURL(/\/workflows\//);
        } else {
            await page.goto(`${web}/workflows/${state.runId}?machineId=${state.machineId}`);
        }
        await page.getByText('Every required approval and check passed', { exact: true }).waitFor({ timeout: 15 * 60000 });
        await shot('30-run-completed'); await shot('31-completed-work', true);
        for (const tab of ['Plan', 'Review', 'Activity']) { await page.getByRole('tab', { name: tab, exact: true }).click(); await shot('32-completed-' + tab.toLowerCase()); await shot('33-completed-' + tab.toLowerCase() + '-lower', true); }
        await page.getByRole('tab', { name: 'Work', exact: true }).click(); await page.setViewportSize({ width: 1440, height: 1000 }); await shot('34-completed-desktop');
        assert.equal(execFileSync('git', ['-C', state.source, 'status', '--porcelain'], { encoding: 'utf8' }), '');
        assert.deepEqual(errors, []);
        assert(state.startedThroughUI && state.manualPlanApproval && state.visitedLivePlannerSession && state.visitedLiveExecutorSession, 'The receipt must record real launch, approval and session visits before reporting completion');
        const result = { ...state, completed: true, sourceUnchanged: true, pageErrors: errors, validatedAt: new Date().toISOString() };
        fs.writeFileSync(path.join(out, 'validation.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result));
    } catch (e) { await page.screenshot({ path: '/tmp/talos-experience-failure.png' }); console.log((await page.locator('body').innerText()).slice(-7000)); throw e; }
    finally { await browser.close(); }
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
