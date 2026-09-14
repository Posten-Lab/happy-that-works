// Real UI launch, provider turns, encrypted checkpoints, and transcript navigation.
// Run only against a fresh local authenticated-empty environment.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { randomUUID, randomBytes, createDecipheriv } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const req = createRequire(path.join(process.cwd(), 'packages/talos-app/package.json'));
const nacl = req('tweetnacl');
const { WorkflowDefinitionSchema, workflowProjection, workflowObjections } = req('@ahmadposten/talos-wire');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
async function saveEncryptedDefinition(api, auth, workflow) {
    const secret = Buffer.from(auth.secret, 'base64');
    for (let attempt = 0; attempt < 5; attempt++) {
        const response = await fetch(api + '/v1/account/settings', { headers: { Authorization: 'Bearer ' + auth.token } });
        assert(response.ok, 'Could not load isolated account settings');
        const current = await response.json();
        let settings = {};
        if (current.settings) {
            const bytes = Buffer.from(current.settings, 'base64');
            const plain = nacl.secretbox.open(bytes.subarray(24), bytes.subarray(0, 24), secret);
            assert(plain, 'Could not decrypt isolated account settings');
            settings = JSON.parse(Buffer.from(plain).toString());
        }
        settings.workflowLibraryV3 = [...(settings.workflowLibraryV3 || []).filter(item => item.name !== workflow.name), workflow];
        settings.experiments = true;
        settings.expWorkflows = true;
        const nonce = randomBytes(24);
        const encrypted = Buffer.concat([nonce, Buffer.from(nacl.secretbox(Buffer.from(JSON.stringify(settings)), nonce, secret))]).toString('base64');
        const save = await fetch(api + '/v1/account/settings', {
            method: 'POST', headers: { Authorization: 'Bearer ' + auth.token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ settings: encrypted, expectedVersion: current.settingsVersion }),
        });
        assert(save.ok, 'Could not save isolated account settings');
        if ((await save.json()).success) return;
        assert(attempt < 4, 'Concurrent settings changes prevented fixture save');
    }
}


async function main() {
    const envDir = process.env.WORKFLOW_E2E_ENV;
    assert(envDir?.includes('/environments/data/envs/'));
    const env = JSON.parse(fs.readFileSync(path.join(envDir, 'environment.json')));
    const api = `http://localhost:${env.serverPort}`, web = `http://localhost:${env.expoPort}`;
    const auth = JSON.parse(fs.readFileSync(path.join(envDir, 'cli/home/access.key')));
    const out = path.resolve('docs/evidence/workflow-planner-visibility'); fs.mkdirSync(out, { recursive: true });
    const statePath = '/tmp/talos-planner-e2e-state.json';
    const slot = (name, assignment) => ({ assignment, agent: { id: randomUUID(), name, revision: 1, provider: 'codex', model: 'gpt-5.6-sol', effort: 'low', permissionMode: 'default', description: '', instructions: 'This is a tiny workflow evidence fixture. Do not delegate. Read files as needed. Follow the stage assignment and return the required JSON including findingResponses.', documents: [] } });
    const steps = [
        { id: randomUUID(), name: 'Plan', kind: 'plan', criteria: 'Exact file bytes and preserved README.', checks: [], agents: [
            slot('Ada', 'Plan owner. Propose creating result.txt. In consolidation round 1, deliberately omit an exact-byte verification command to exercise the review process. In consolidation round 2, fix Ben’s objection by including a Python exact-byte assertion for done followed by newline and unchanged README, and explicitly mark his finding addressed using its ID. Do not write files.'),
            slot('Ben', 'Reliability assessor. In plan_vote round 1, request changes with one blocking finding titled Exact-byte verification missing. Require an explicit byte-level check for result.txt including trailing newline and preserved README. On later rounds, inspect the plan and approve only when corrected; explicitly verify your original finding ID with evidence. Do not write files.'),
            slot('Chen', 'Scope assessor. Propose the smallest file write, preserving README. Vote for a plan that preserves existing files. Do not write files.'),
        ] },
        { id: randomUUID(), name: 'Build', kind: 'execute', criteria: 'Write requested bytes.', checks: [], agents: [slot('Builder', 'Write result.txt with exactly done and a newline. Preserve README.md.')] },
        { id: randomUUID(), name: 'Review', kind: 'review', criteria: 'Verify actual bytes.', checks: [], agents: [slot('Reviewer', 'Read the files. Verify result.txt is exactly done and newline, README remains Visibility fixture newline.')] },
    ];
    const definition = WorkflowDefinitionSchema.parse({ id: randomUUID(), revision: 1, name: 'Planner visibility E2E', description: '', steps, ...workflowProjection(steps), criteria: 'result.txt contains exactly done and a newline; README.md remains unchanged.', checks: [{ name: 'Exact bytes', command: `python3 -c 'from pathlib import Path; assert Path("result.txt").read_bytes()==b"done\\n"; assert Path("README.md").read_bytes()==b"Visibility fixture\\n"'` }], planningRounds: 3, reviewRounds: 2, turnMinutes: 3, maxTurns: 24, approvePlan: true, updatedAt: Date.now() });
    const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--remote-debugging-port=62399'] });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
    await context.addInitScript(({ auth, origin }) => { if (location.origin === origin) { localStorage.setItem('auth_credentials', JSON.stringify(auth)); localStorage.setItem('mmkv.default\\local-settings', JSON.stringify({ themePreference: 'dark' })); } }, { auth, origin: web });
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const button = name => page.getByRole('button', { name, exact: true });
    const shot = async name => { await page.waitForTimeout(600); await page.screenshot({ path: path.join(out, name + '.png') }); console.log('Captured', name); };
    let state;
    function checkpoint() {
        const root = path.join(envDir, 'cli/home/workflows');
        const find = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? find(path.join(directory, entry.name)) : entry.name === state.runId + '.bin' ? [path.join(directory, entry.name)] : []);
        const file = find(root)[0]; assert(file, 'Encrypted checkpoint missing');
        const bytes = fs.readFileSync(file), key = Buffer.from(auth.encryption?.machineKey || auth.secret, 'base64');
        const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(1, 13)); decipher.setAuthTag(bytes.subarray(-16));
        return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(13, -16)), decipher.final()]).toString());
    }
    try {
        if (process.env.WORKFLOW_E2E_RESUME) { state = JSON.parse(fs.readFileSync(statePath)); await page.goto(state.url); }
        else {
            const source = fs.mkdtempSync('/tmp/talos-planner-fixture-'); fs.writeFileSync(path.join(source, 'README.md'), 'Visibility fixture\n');
            execFileSync('git', ['init', '-q', source]); execFileSync('git', ['-C', source, 'add', '.']); execFileSync('git', ['-C', source, '-c', 'user.name=Talos E2E', '-c', 'user.email=e2e@example.invalid', 'commit', '-qm', 'Fixture']);
            await saveEncryptedDefinition(api, auth, definition);
            await page.goto(`${web}/workflows/run?workflowId=${definition.id}`);
            await page.getByRole('textbox', { name: 'Workflow task', exact: true }).fill('Create result.txt containing exactly done and a newline. Preserve README.md.', { timeout: 60000 });
            await page.getByRole('button', { name: /^Project:/ }).click(); await page.getByRole('textbox', { name: 'Project directory', exact: true }).fill(source); await button('Use this project').click();
            await button('Start workflow').click(); await page.waitForURL(/\/workflows\/[0-9a-f-]{36}\?machineId=/, { timeout: 180000 });
            state = { runId: new URL(page.url()).pathname.split('/').pop(), url: page.url(), source }; fs.writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
            await button('Inspect Ada history').waitFor(); await button('Inspect Ben history').waitFor(); await button('Inspect Chen history').waitFor(); await shot('01-all-planners-live');
        }
        const deadline = Date.now() + 12 * 60000;
        while (Date.now() < deadline) {
            const run = checkpoint();
            if (run.status === 'complete' || run.stage !== 'propose' && run.stage !== 'consolidate' && run.stage !== 'plan_vote') break; if (run.status !== 'running') { assert.equal(run.stage, 'plan_vote', run.reason); assert.equal(run.status, 'needs_input', run.reason); break; }
            console.log(JSON.stringify({ stage: run.stage, round: run.planningRound, tasks: run.tasks.length }));
            await page.waitForTimeout(10000);
        }
        const agreed = checkpoint(); assert(['needs_input', 'running', 'complete'].includes(agreed.status)); assert(agreed.planVersion >= 2);
        assert(agreed.tasks.every(task => task.inputs && task.sessionId && task.participants));
        const objection = workflowObjections(agreed.tasks).find(item => item.task.stage === 'plan_vote' && item.finding.title === 'Exact-byte verification missing'); assert(objection); assert.equal(objection.status, 'verified'); assert(objection.responses.some(response => response.status === 'addressed'));
        await button('Inspect Plan team').click(); await button('Inspect Ben history').click(); await page.getByRole('button', { name: 'Read Ben plan_vote round 1', exact: true }).click();
        await button('Open full transcript').waitFor(); await shot('02-original-objection');
        await button('Read original prompt').click(); assert((await page.locator('body').innerText()).includes('SHARED INPUTS'));
        await button('Open full transcript').click(); await page.waitForURL(/\/session\//); await page.waitForTimeout(3000); await shot('03-source-transcript');
        await button('Back to workflow').click(); await page.waitForURL(/\/workflows\//); await button('Close evidence').click();
        await button('Show Everyone contributions').click(); await page.getByRole('tab', { name: 'Decisions', exact: true }).click();
        await page.getByText('Objections and resolutions', { exact: true }).scrollIntoViewIfNeeded(); await shot('04-resolution-history');
        await page.getByRole('tab', { name: 'Plan', exact: true }).click(); await button('Read plan v2').click(); await button('Compare with previous plan').click(); await page.waitForTimeout(800); await shot('05-plan-comparison'); await button('Close evidence').click();
        await page.setViewportSize({ width: 1440, height: 1000 }); await page.getByRole('tab', { name: 'Discussion', exact: true }).click(); await button('Read Ben plan_vote round 1').click(); await shot('06-desktop-evidence'); await button('Close evidence').click();
        await page.setViewportSize({ width: 390, height: 844 }); if (checkpoint().stage === 'plan_vote') { await button('Approve agreed plan').click(); await button('Approve agreed plan').waitFor({ state: 'hidden', timeout: 30000 }); }
        const completionDeadline = Date.now() + 8 * 60000;
        while (Date.now() < completionDeadline) { const run = checkpoint(); if (run.status === 'needs_input' && run.stage === 'plan_vote') { await page.waitForTimeout(1000); continue; } if (run.status !== 'running') { assert.equal(run.status, 'complete', run.reason); break; } console.log(JSON.stringify({ stage: run.stage, tasks: run.tasks.length })); await page.waitForTimeout(10000); }
        const complete = checkpoint(); assert.equal(complete.status, 'complete');
        await button('Inspect Plan team').click(); await button('Inspect Ben history').click(); await button('Read Ben plan_vote round 1').waitFor(); await shot('07-history-after-completion');
        assert.equal(fs.readFileSync(path.join(complete.directory, 'result.txt'), 'utf8'), 'done\n'); assert(complete.checks.every(check => check.exitCode === 0));
        assert.equal(execFileSync('git', ['-C', state.source, 'status', '--porcelain'], { encoding: 'utf8' }), ''); assert.deepEqual(errors, []);
        const evidence = { runId: complete.id, actualUIStart: true, realProvider: 'codex', planners: 3, planVersions: complete.planVersion, taskSessions: complete.tasks.length, explicitResolution: objection.responses.map(r => ({ agent: r.task.agentName, status: r.status, version: r.task.version })), sourceTranscriptOpened: true, planComparison: true, plannerHistoryAfterCompletion: true, checks: complete.checks.map(c => ({ name: c.name, exitCode: c.exitCode })), sourceUnchanged: true, pageErrors: errors, validatedAt: new Date().toISOString() };
        fs.writeFileSync(path.join(out, 'validation.json'), JSON.stringify(evidence, null, 2)+'\n'); console.log(JSON.stringify(evidence));
    } catch (error) { await shot('failure'); console.log((await page.locator('body').innerText()).slice(-3000)); throw error; }
    finally { await browser.close(); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
