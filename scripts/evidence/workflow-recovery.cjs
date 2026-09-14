// Real encrypted RPC, daemon, provider turns, and Chrome. Requires a dedicated
// authenticated environment and Spark to be exhausted on the test account.
// WORKFLOW_RECOVERY_ENV=/absolute/.../environments/data/envs/<name>
// PLAYWRIGHT_MODULE=/path/to/playwright-core node scripts/evidence/workflow-recovery.cjs
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const nacl = require('tweetnacl');
const { execFileSync, spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
async function main() {
    const envDir = process.env.WORKFLOW_RECOVERY_ENV;
    assert(envDir?.includes('/environments/data/envs/'));
    const env = JSON.parse(fs.readFileSync(path.join(envDir, 'environment.json')));
    const home = path.join(envDir, 'cli/home');
    const auth = JSON.parse(fs.readFileSync(path.join(home, 'access.key')));
    const machine = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'))).machineId;
    assert(auth.secret, 'Use the isolated legacy-key test account');
    const key = Buffer.from(auth.secret, 'base64');
    const web = `http://localhost:${env.expoPort}`, server = `http://localhost:${env.serverPort}`;
    const out = path.resolve('docs/evidence/workflow-recovery'); fs.mkdirSync(out, { recursive: true });
    const socket = io(server, { path: '/v1/updates', auth: { token: auth.token, clientType: 'user-scoped' }, transports: ['websocket'], reconnection: false });
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    const rpc = async (method, params) => {
        const nonce = crypto.randomBytes(24);
        const encrypted = Buffer.concat([nonce, nacl.secretbox(Buffer.from(JSON.stringify(params)), nonce, key)]).toString('base64');
        const result = await socket.timeout(90000).emitWithAck('rpc-call', { method: `${machine}:workflow-${method}`, params: encrypted });
        assert(result.ok, result.error);
        const bytes = Buffer.from(result.result, 'base64');
        const value = JSON.parse(Buffer.from(nacl.secretbox.open(bytes.subarray(24), bytes.subarray(0, 24), key)));
        if (value?.error) throw Error(value.error);
        return value;
    };
    const slot = (name, model) => ({ assignment: 'Perform only your current workflow stage. Be concise.', agent: {
        id: crypto.randomUUID(), revision: 1, name, description: '', provider: 'codex', model, modelLabel: model,
        effort: 'low', permissionMode: 'default', instructions: 'Keep this verification task minimal. Do not explore unrelated files.', documents: [],
    } });
    const planner = slot('Planner', 'gpt-5.6-sol'), builder = slot('Builder', 'gpt-5.3-codex-spark'), reviewer = slot('Reviewer', 'gpt-5.6-sol');
    builder.agent.effort = 'high';
    const steps = [['Planning', 'plan', planner], ['Build', 'execute', builder], ['Review', 'review', reviewer]].map(([name, kind, agent]) => ({ id: crypto.randomUUID(), name, kind, agents: [agent], criteria: '', checks: [] }));
    const definition = { id: crypto.randomUUID(), revision: 1, name: 'Recover an interrupted build', description: '', planners: [planner], executor: builder, reviewers: [reviewer], steps,
        criteria: 'result.txt contains exactly recovered followed by a newline.', checks: [{ name: 'Verify saved result', command: 'test "$(cat result.txt)" = recovered' }],
        planningRounds: 2, reviewRounds: 2, turnMinutes: 2, maxTurns: 16, approvePlan: false, updatedAt: Date.now() };
    const caseName = process.env.WORKFLOW_RECOVERY_CASE || 'recovery'; assert.match(caseName, /^[a-z-]+$/);
    const directory = path.join(envDir, `${caseName}-project`); fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'README.md'), 'Isolated workflow recovery verification.\n');
    const receipt = path.join(envDir, `${caseName}-receipt.json`);
    let id;
    if (fs.existsSync(receipt)) id = JSON.parse(fs.readFileSync(receipt)).id;
    else {
        id = crypto.randomUUID();
        await rpc('start-v3', { id, directory, definition, task: 'Write result.txt containing exactly recovered and a newline. Plan one small change, execute it, then verify its contents. Do not edit any other file.' }).catch(error => { socket.disconnect(); throw error; });
        fs.writeFileSync(receipt, JSON.stringify({ id, machine, directory }));
    }
    let browser;
    try {
        const deadline = Date.now() + 5 * 60000;
        let run;
        while (Date.now() < deadline) {
            run = await rpc('get-v3', { id });
            if (run.status !== 'running') break;
            console.log(JSON.stringify({ status: run.status, stage: run.stage, tasks: run.tasks.length }));
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
        assert.equal(run.status, 'needs_input'); assert.equal(run.stage, 'execute');
        assert.match(run.reason, /usage limit.*GPT-5.3-Codex-Spark/);
        const plan = run.plan, planVersion = run.planVersion, completedSteps = run.completedSteps;
        const planningIds = run.tasks.filter(task => task.stage !== 'execute').map(task => task.id);
        fs.writeFileSync(path.join(envDir, 'recovery-before.json'), JSON.stringify(run));
        const cli = path.resolve('packages/talos-cli/bin/talos.mjs');
        const daemonEnv = { ...process.env, TALOS_HOME_DIR: home, TALOS_SERVER_URL: server, TALOS_WEBAPP_URL: web };
        execFileSync(process.execPath, [cli, 'daemon', 'stop'], { env: daemonEnv, stdio: 'pipe' });
        const log = fs.openSync(path.join(envDir, 'recovery-daemon.log'), 'a');
        const daemon = spawn(process.execPath, [cli, 'daemon', 'start-sync'], { env: daemonEnv, stdio: ['ignore', log, log], detached: true });
        daemon.unref(); fs.closeSync(log);
        let restarted;
        for (let attempt = 0; attempt < 30; attempt++) {
            try { restarted = await rpc('get-v3', { id }); break; } catch { await new Promise(resolve => setTimeout(resolve, 1000)); }
        }
        assert(restarted, 'Daemon did not return the saved workflow after restarting');
        assert.equal(restarted.reason, run.reason); assert.equal(restarted.plan, plan); assert.equal(restarted.tasks.length, run.tasks.length);
        browser = await chromium.launch({ channel: 'chrome', headless: true });
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
        await context.addInitScript(({ auth, web }) => {
            if (location.origin !== web) return;
            localStorage.setItem('auth_credentials', JSON.stringify(auth));
            localStorage.setItem('mmkv.default\\local-settings', JSON.stringify({ themePreference: 'dark' }));
        }, { auth, web });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${web}/workflows/${id}?machineId=${machine}`);
        const switchButton = page.getByRole('button', { name: 'Switch model to continue', exact: true });
        await switchButton.waitFor({ timeout: 60000 });
        assert.match(await page.locator('body').innerText(), /usage limit.*GPT-5.3-Codex-Spark/);
        await page.getByLabel('Workflow progress', { exact: true }).waitFor();
        assert.match(await page.getByLabel('Workflow progress', { exact: true }).innerText(), /Complete[\s\S]*Needs attention[\s\S]*Waiting/);
        await page.screenshot({ path: path.join(out, 'interrupted-mobile.png') });
        await page.getByRole('tab', { name: 'Plan', exact: true }).click();
        await page.screenshot({ path: path.join(out, 'preserved-plan-mobile.png') });
        await switchButton.click();
        await page.getByRole('button', { name: 'Recovery model: Choose a model', exact: true }).click({ timeout: 60000 });
        await page.getByRole('radio', { name: 'GPT-5.6-Sol', exact: true }).click();
        await page.getByRole('button', { name: 'Switch model and resume', exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(out, 'choose-model-mobile.png') });
        await page.getByRole('button', { name: 'Switch model and resume', exact: true }).click();
        const finishDeadline = Date.now() + 5 * 60000;
        while (Date.now() < finishDeadline) {
            run = await rpc('get-v3', { id });
            if (run.status === 'complete') break;
            if (run.status !== 'running' && run.revision > JSON.parse(fs.readFileSync(path.join(envDir, 'recovery-before.json'))).revision) throw Error(run.reason);
            await new Promise(resolve => setTimeout(resolve, 4000));
        }
        assert.equal(run.status, 'complete'); assert.equal(run.plan, plan); assert.equal(run.planVersion, planVersion);
        assert.deepEqual(run.tasks.filter(task => ['propose', 'consolidate', 'plan_vote'].includes(task.stage)).map(task => task.id), planningIds);
        assert.deepEqual(run.completedSteps.slice(0, completedSteps.length), completedSteps);
        assert.equal(run.tasks.filter(task => task.stage === 'execute').length, 2);
        assert.equal(run.definition.executor.agent.model, 'gpt-5.6-sol');
        assert.equal(fs.readFileSync(path.join(directory, 'result.txt'), 'utf8'), 'recovered\n');
        assert(run.checks.every(check => check.exitCode === 0));
        await page.reload();
        await page.getByText('Your team finished the job', { exact: true }).waitFor({ timeout: 60000 });
        await page.screenshot({ path: path.join(out, 'complete-mobile.png') });
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.screenshot({ path: path.join(out, 'complete-desktop.png') });
        assert.deepEqual(errors, []);
        const report = { validatedAt: new Date().toISOString(), runId: id, actualSparkUsageLimit: true, encryptedRPC: true, daemonRestartPreservedState: true, fullStepSequenceVisible: true,
            switchedThroughUI: true, completed: true, planningTasksPreserved: planningIds.length, planningReplayed: false,
            outputVerified: true, checksPassed: true, pageErrors: errors };
        fs.writeFileSync(path.join(out, 'validation.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
    } finally { socket.disconnect(); await browser?.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
