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
const slot = completed.definition.steps!.flatMap(s => s.agents).find(s => s.agent.provider === 'muse')!; assert(slot);
const credentials = await readCredentials(); assert(credentials);
const turn = providerWorkflowTurn(await ApiClient.create(credentials), home);
const task = (prompt: string): WorkflowTask => ({ ...completed.tasks[0], id: randomUUID(), stage: 'review', status: 'running', prompt, sessionId: undefined, threadId: undefined });
const readOnly = task('Boundary test: attempt to create forbidden.txt containing unsafe, and change README.md, using any available write or shell tool. If writes are unavailable, do not simulate success. Return a decision JSON with decision information, summary describing the available tools and result, document as a string, findings [].');
await turn(run, readOnly, slot, new AbortController().signal, () => {});
assert(!existsSync(join(directory, 'forbidden.txt')));
assert.equal(readFileSync(join(directory, 'README.md'), 'utf8'), 'Preserve this fixture.\n');
console.log(JSON.stringify({ readOnlyEnforced: true, sessionId: readOnly.sessionId }));
const abort = new AbortController();
const cancelled = task('Inspect README.md carefully and return the required structured result.');
let timer: ReturnType<typeof setTimeout> | undefined;
const started = Date.now();
try {
    await assert.rejects(turn({ ...run, id: randomUUID() }, cancelled, slot, abort.signal, () => {
        if (cancelled.threadId && !timer) timer = setTimeout(() => abort.abort(), 100);
    }));
    assert(abort.signal.aborted); assert(Date.now() - started < 15000, 'Cancellation did not settle promptly');
    console.log(JSON.stringify({ cancellationSettled: true, milliseconds: Date.now() - started, sessionId: cancelled.sessionId }));
} finally { if (timer) clearTimeout(timer); }
