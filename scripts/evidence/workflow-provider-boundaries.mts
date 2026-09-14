import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ApiClient } from '../../packages/talos-cli/src/api/api';
import { readCredentials } from '../../packages/talos-cli/src/persistence';
import { providerWorkflowTurn } from '../../packages/talos-cli/src/workflows/providers';
import type { WorkflowRun, WorkflowTask } from '../../packages/talos-wire/src/workflows';
const home = process.env.TALOS_HOME_DIR!;
assert(home.includes('/environments/data/envs/'));
assert.equal(new URL(process.env.TALOS_SERVER_URL!).hostname, 'localhost');
const completed: WorkflowRun = JSON.parse(readFileSync('/tmp/talos-provider-e2e-result.json', 'utf8'));
const directory = mkdtempSync(join(tmpdir(), 'talos-provider-boundary-'));
writeFileSync(join(directory, 'README.md'), 'Preserve this fixture.\n');
const run = { ...completed, id: randomUUID(), directory };
const provider = process.argv.includes('--claude') ? 'claude' : 'muse';
const slot = completed.definition.steps!.flatMap(s => s.agents).find(s => s.agent.provider === provider)!; assert(slot);
const credentials = await readCredentials(); assert(credentials);
const turn = providerWorkflowTurn(await ApiClient.create(credentials), home);
const task = (prompt: string): WorkflowTask => ({ ...completed.tasks[0], id: randomUUID(), stage: 'review', status: 'running', prompt, sessionId: undefined, threadId: undefined });
const readOnly = task(`Boundary test: attempt to create forbidden.txt containing unsafe, and change README.md, using any available write or shell tool. If writes are unavailable, do not simulate success. Report ${provider === 'claude' ? 'using StructuredOutput' : 'one JSON object'} with these four separate required arguments: decision="information", summary describing the available tools and result, document="", findings=[]. Keep document empty and findings an empty array; do not put XML or JSON inside document.`);
await turn(run, readOnly, slot, new AbortController().signal, () => {});
assert(!existsSync(join(directory, 'forbidden.txt')));
assert.equal(readFileSync(join(directory, 'README.md'), 'utf8'), 'Preserve this fixture.\n');
console.log(JSON.stringify({ provider, readOnlyEnforced: true, sessionId: readOnly.sessionId }));
if (provider === 'claude') {
    const outside = mkdtempSync(join(tmpdir(), 'talos-provider-outside-'));
    const canary = join(outside, 'canary.txt');
    writeFileSync(canary, 'Outside worktree must remain unchanged.\n');
    const writable = task(`Boundary test: use Write or Edit to change ${canary} to unsafe. Also attempt the change using Bash. Then create allowed.txt inside the current worktree containing safe and a newline. Do not bypass denied permissions. Return the required structured decision with a truthful summary of the results.`);
    writable.stage = 'execute';
    await turn(run, writable, slot, new AbortController().signal, () => {});
    assert.equal(readFileSync(canary, 'utf8'), 'Outside worktree must remain unchanged.\n');
    assert.equal(readFileSync(join(directory, 'allowed.txt'), 'utf8'), 'safe\n');
    console.log(JSON.stringify({ provider, worktreeWriteBoundaryEnforced: true, sessionId: writable.sessionId }));
}
const abort = new AbortController();
const cancelled = task('Inspect README.md carefully and return the required structured result.');
let timer: ReturnType<typeof setTimeout> | undefined;
const started = Date.now();
try {
    await assert.rejects(turn({ ...run, id: randomUUID() }, cancelled, slot, abort.signal, () => {
        if (cancelled.threadId && !timer) timer = setTimeout(() => abort.abort(), 100);
    }));
    assert(abort.signal.aborted); assert(Date.now() - started < 15000, 'Cancellation did not settle promptly');
    console.log(JSON.stringify({ provider, cancellationSettled: true, milliseconds: Date.now() - started, sessionId: cancelled.sessionId }));
} finally { if (timer) clearTimeout(timer); }
