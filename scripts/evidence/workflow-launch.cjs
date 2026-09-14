// Actual launch UI -> encrypted RPC -> native provider turns. Isolated environment only.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const req = createRequire(path.join(process.cwd(), 'packages/talos-app/package.json'));
const nacl = req('tweetnacl');
const { WorkflowDefinitionSchema, workflowProjection } = req('@ahmadposten/talos-wire');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

async function main() {
    const envDir = process.env.WORKFLOW_E2E_ENV;
    assert(envDir?.includes('/environments/data/envs/'), 'Set WORKFLOW_E2E_ENV to an isolated Talos environment');
    const env = JSON.parse(fs.readFileSync(path.join(envDir, 'environment.json')));
    const api = `http://localhost:${env.serverPort}`, web = `http://localhost:${env.expoPort}`;
    const auth = JSON.parse(fs.readFileSync(path.join(envDir, 'cli/home/access.key')));
    assert(auth.token && auth.secret);
    const secret = Buffer.from(auth.secret, 'base64');
    const source = fs.mkdtempSync('/tmp/talos-launch-ui-');
    fs.writeFileSync(path.join(source, 'README.md'), 'Launch fixture.\n');
    execFileSync('git', ['init', '-q', source]);
    execFileSync('git', ['-C', source, 'add', '.']);
    execFileSync('git', ['-C', source, '-c', 'user.name=Talos E2E', '-c', 'user.email=e2e@example.invalid', 'commit', '-qm', 'Fixture']);
    const slot = (name, provider, assignment) => ({ assignment, agent: {
        id: randomUUID(), name, revision: 1, provider, model: provider === 'codex' ? 'gpt-5.6-sol' : provider === 'claude' ? 'sonnet' : 'default',
        effort: 'low', permissionMode: name === 'Builder' ? 'default' : 'read-only', description: '', instructions: 'Complete this small fixture task. Read actual files for evidence. Do not delegate. Return the requested decision JSON.', documents: [],
    } });
    const steps = [
        { id: randomUUID(), name: 'Plan', kind: 'plan', agents: [slot('Planner', 'codex', 'Plan creating result.txt with exactly done and a newline. Preserve README.md. Do not write files.')], criteria: 'A small exact plan.', checks: [] },
        { id: randomUUID(), name: 'Build', kind: 'execute', agents: [slot('Builder', 'claude', 'Create result.txt with exactly done and a newline. Preserve README.md.')], criteria: 'Requested output exists.', checks: [] },
        { id: randomUUID(), name: 'Review', kind: 'review', agents: [slot('Reviewer', 'muse', 'Read result.txt and README.md. Verify exact output and unchanged README. Do not write files.')], criteria: 'Verified output.', checks: [] },
    ];
    const definition = WorkflowDefinitionSchema.parse({ id: randomUUID(), revision: 1, name: 'Launch verification', description: 'A three-provider UI launch check.', steps, ...workflowProjection(steps), criteria: 'result.txt contains exactly done and newline; README.md unchanged.', checks: [{ name: 'Verify output', command: `python3 -c 'from pathlib import Path; assert Path("result.txt").read_text() == "done\\n"; assert Path("README.md").read_text() == "Launch fixture.\\n"'` }], planningRounds: 2, reviewRounds: 2, turnMinutes: 3, maxTurns: 15, approvePlan: false, updatedAt: Date.now() });
    for (let attempt = 0; attempt < 5; attempt++) {
        const response = await fetch(api + '/v1/account/settings', { headers: { Authorization: 'Bearer ' + auth.token } }); assert(response.ok);
        const current = await response.json();
        let settings = {};
        if (current.settings) { const bytes = Buffer.from(current.settings, 'base64'); const plain = nacl.secretbox.open(bytes.subarray(24), bytes.subarray(0, 24), secret); assert(plain); settings = JSON.parse(Buffer.from(plain).toString()); }
        settings.workflowLibraryV3 = [...(settings.workflowLibraryV3 || []).filter(item => item.name !== 'Launch verification'), definition];
        settings.experiments = true; settings.expWorkflows = true;
        const nonce = randomBytes(24);
        const encrypted = Buffer.concat([nonce, Buffer.from(nacl.secretbox(Buffer.from(JSON.stringify(settings)), nonce, secret))]).toString('base64');
        const save = await fetch(api + '/v1/account/settings', { method: 'POST', headers: { Authorization: 'Bearer ' + auth.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: encrypted, expectedVersion: current.settingsVersion }) });
        assert(save.ok); const result = await save.json();
        if (result.success) break;
        assert(attempt < 4, 'Concurrent settings changes prevented fixture save');
    }
    const evidence = path.join(process.cwd(), 'docs/evidence/workflow-wizard'); fs.mkdirSync(evidence, { recursive: true });
    console.log(JSON.stringify({ fixtureSaved: true, workflowId: definition.id }));
    const browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 30000, args: process.env.WORKFLOW_E2E_DEBUG_PORT ? [`--remote-debugging-port=${process.env.WORKFLOW_E2E_DEBUG_PORT}`] : [] });
    console.log('Browser launched');
    try {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        await context.addInitScript(({ origin, credentials }) => { if (location.origin === origin) localStorage.setItem('auth_credentials', JSON.stringify(credentials)); }, { origin: web, credentials: auth });
        const page = await context.newPage();
        const button = name => page.getByRole('button', { name, exact: true });
        await page.goto(`${web}/workflows/run?workflowId=${definition.id}`);
        await page.getByRole('textbox', { name: 'Workflow task', exact: true }).waitFor({ timeout: 60000 });
        console.log('Run screen loaded');
        await page.getByRole('textbox', { name: 'Workflow task', exact: true }).fill('Create result.txt containing exactly done and a newline. Preserve README.md.');
        await page.getByRole('button', { name: /^Project:/ }).click();
        await page.getByRole('textbox', { name: 'Project directory', exact: true }).fill('/tmp/talos-missing-launch-fixture');
        await button('Use this project').click();
        await button('Start workflow').click(); console.log('Start pressed');
        await page.getByText('The project folder could not be found on this machine.', { exact: false }).waitFor({ timeout: 180000 });
        await page.screenshot({ path: path.join(evidence, 'launch-path-error.png'), fullPage: true });
        assert(await button('Start workflow').isEnabled(), 'Rejected path must unlock after absent receipt');
        await page.getByRole('button', { name: /^Project:/ }).click();
        await page.getByRole('textbox', { name: 'Project directory', exact: true }).fill(source);
        await page.screenshot({ path: path.join(evidence, 'launch-project-picker.png') });
        await button('Use this project').click();
        await page.screenshot({ path: path.join(evidence, 'launch-ready.png') });
        await button('Start workflow').click(); console.log('Start pressed');
        await page.waitForURL(/\/workflows\/[0-9a-f-]{36}\?machineId=/, { timeout: 180000 });
        const runId = new URL(page.url()).pathname.split('/').pop();
        console.log(JSON.stringify({ workflowId: definition.id, runId, source, invalidPathRecovery: true, sharedPicker: true, actualUIStart: true }));
        fs.writeFileSync('/tmp/talos-workflow-launch-result.json', JSON.stringify({ workflowId: definition.id, runId, source, machineId: new URL(page.url()).searchParams.get('machineId') }), { mode: 0o600 });
        await page.getByText('Every required approval and check passed', { exact: true }).waitFor({ timeout: 15 * 60000 });
        await page.screenshot({ path: path.join(evidence, 'launch-complete.png'), fullPage: true });
        assert.equal(fs.existsSync(path.join(source, 'result.txt')), false);
        assert.equal(execFileSync('git', ['-C', source, 'status', '--porcelain'], { encoding: 'utf8' }), '');
        console.log(JSON.stringify({ complete: true, sourceUnchanged: true, threeNativeProviders: true }));
    } finally { await browser.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
