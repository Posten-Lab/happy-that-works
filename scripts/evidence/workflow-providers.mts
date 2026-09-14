/** Actual provider turns + API participant sessions + encrypted disk state. Run only against an isolated env. */
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ApiClient } from '../../packages/talos-cli/src/api/api';
import { readCredentials, readSettings } from '../../packages/talos-cli/src/persistence';
import { workflowRuntime } from '../../packages/talos-cli/src/workflows/runtime';
import { WorkflowCoordinator } from '../../packages/talos-cli/src/workflows/coordinator';
import { WorkflowStore } from '../../packages/talos-cli/src/workflows/store';
import { workflowProjection, type WorkflowStep } from '../../packages/talos-wire/src/workflows';

const home = process.env.TALOS_HOME_DIR;
assert(home?.includes('/environments/data/envs/'), 'Use an isolated authenticated-empty environment');
assert(new URL(process.env.TALOS_SERVER_URL!).hostname === 'localhost');
const source = mkdtempSync(join(tmpdir(), 'talos-provider-e2e-'));
writeFileSync(join(source, 'README.md'), 'Provider workflow fixture.\n');
execFileSync('git', ['init', '-q', source]); execFileSync('git', ['-C', source, 'add', '.']);
execFileSync('git', ['-C', source, '-c', 'user.name=Talos E2E', '-c', 'user.email=e2e@example.invalid', 'commit', '-qm', 'Fixture']);
const slot = (id: string, provider: 'claude' | 'muse' | 'codex', assignment: string) => ({ assignment, agent: {
    id, name: id, revision: 1, provider, model: provider === 'claude' ? 'sonnet' : provider === 'muse' ? 'default' : 'gpt-5.6-sol',
    effort: 'low', permissionMode: 'default' as const, description: '', instructions: 'Follow only this small fixture task. Report concrete file evidence. Do not use delegation. Return the requested decision JSON.', documents: [],
} });
const steps: WorkflowStep[] = [
    { id: randomUUID(), name: 'Plan', kind: 'plan', agents: [slot('Planner', 'claude', 'Plan all five steps: first create result.txt with stage one, review it, change to stage two, review it. Do not write files.')], criteria: 'A small exact plan for the sequence.', checks: [] },
    { id: randomUUID(), name: 'Build', kind: 'execute', agents: [slot('Builder', 'claude', 'Create result.txt with exactly stage one and a newline. Preserve README.md. Stage two belongs to the later step.')], criteria: 'Intermediate output only.', checks: [] },
    { id: randomUUID(), name: 'Review intermediate', kind: 'review', agents: [slot('Reviewer', 'muse', 'Read result.txt and verify stage one and newline; README.md unchanged. No writing.')], criteria: 'Only intermediate output is required here.', checks: [{ name: 'Intermediate output', command: `python3 -c 'from pathlib import Path; assert Path("result.txt").read_text() == "stage one\\n"'` }] },
    { id: randomUUID(), name: 'Polish', kind: 'execute', agents: [slot('Polisher', 'muse', 'Change result.txt to exactly stage two and newline. Preserve README.md. Do not change other files.')], criteria: 'Final output.', checks: [] },
    { id: randomUUID(), name: 'Final review', kind: 'review', agents: [slot('Final reviewer', 'codex', 'Read result.txt and verify exactly stage two and newline. Verify README.md unchanged. Do not write.')], criteria: 'Final output verified.', checks: [] },
];
if (process.argv.includes('--without-claude')) {
    for (const step of steps) for (const slot of step.agents) if (slot.agent.provider === 'claude') { slot.agent.provider = 'codex'; slot.agent.model = 'gpt-5.6-sol'; }
}
const definition = { id: randomUUID(), revision: 1, name: 'Mixed provider E2E', description: '', steps, ...workflowProjection(steps), criteria: 'result.txt is exactly stage two and newline, README.md unchanged.', checks: [{ name: 'Final output', command: `python3 -c 'from pathlib import Path; assert Path("result.txt").read_text() == "stage two\\n"; assert Path("README.md").read_text() == "Provider workflow fixture.\\n"'` }], planningRounds: 2, reviewRounds: 2, turnMinutes: 3, maxTurns: 24, approvePlan: false, updatedAt: Date.now() };
const credentials = await readCredentials(); assert(credentials);
const machineId = (await readSettings()).machineId!; assert(machineId);
const api = await ApiClient.create(credentials);
const store = new WorkflowStore(home!, 'provider-e2e-' + randomUUID(), randomBytes(32));
const coordinator = new WorkflowCoordinator(store, workflowRuntime(api, home!), machineId);
let runId: string | undefined;
try {
    const run = await coordinator.start({ id: randomUUID(), definition, directory: source, task: 'Complete the five fixture steps in order. Build stage one, review intermediate, polish stage two, final review. Preserve README.md. Each step only does its assigned phase.' });
    runId = run.id; console.log(JSON.stringify({ runId, source, directory: run.directory, started: true }));
    let last = '';
    const deadline = Date.now() + 15 * 60000;
    while (Date.now() < deadline) {
        const current = coordinator.get(run.id);
        const state = JSON.stringify({ status: current.status, stage: current.stage, step: current.stepIndex, tasks: current.tasks.map(t => ({ stage: t.stage, status: t.status, error: t.error })) });
        if (state !== last) { console.log(state); last = state; }
        if (current.status !== 'running') {
            writeFileSync('/tmp/talos-provider-e2e-result.json', JSON.stringify(current, null, 2), { mode: 0o600 });
            assert.equal(current.status, 'complete', current.reason);
            assert.equal(readFileSync(join(run.directory, 'result.txt'), 'utf8'), 'stage two\n');
            assert.equal(existsSync(join(source, 'result.txt')), false);
            assert.equal(execFileSync('git', ['-C', source, 'status', '--porcelain'], { encoding: 'utf8' }), '');
            assert(current.tasks.every(t => t.sessionId && t.threadId && t.status === 'done'));
            assert.equal(store.load()[0].status, 'complete');
            console.log(JSON.stringify({ complete: true, encryptedReload: true, sourceUnchanged: true, tasks: current.tasks.length }));
            break;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.equal(coordinator.get(run.id).status, 'complete', 'E2E deadline exceeded');
} finally { await coordinator.shutdown(); }
