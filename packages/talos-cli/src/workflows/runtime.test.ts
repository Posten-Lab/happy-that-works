import { describe, it, expect, vi } from 'vitest';
const state = vi.hoisted(() => ({ events: [] as Record<string, unknown>[] }));
vi.mock('@/codex/codexAppServerClient', () => ({ CodexAppServerClient: class {
    handler: (event: Record<string, unknown>) => void = () => {};
    setApprovalHandler() {} setEventHandler(handler: typeof this.handler) { this.handler = handler; }
    async connect() {} async disconnect() {}
    async startThread() { return { threadId: 'thread', model: 'test-model' }; }
    async sendTurnAndWait() { for (const event of state.events) this.handler(event); return { aborted: false }; }
} }));
import { workflowRuntime } from './runtime';
import { definition } from './testFixture';
import type { WorkflowRun, WorkflowTask } from '@ahmadposten/talos-wire';
import type { ApiClient } from '@/api/api';

async function turn() {
    const sync = { keepAlive() {}, updateMetadata() {}, sendProviderUserMessage() {}, sendSessionProtocolMessage() {}, sendSessionDeath() {}, async flush() {}, async close() {} };
    const api = { async getOrCreateSession() { return { id: 'session' }; }, sessionSyncClient: () => sync } as unknown as ApiClient;
    const run = { id: 'run', directory: '/tmp', machineId: 'machine', definition: definition() } as WorkflowRun;
    const task = { id: 'task', stage: 'execute', prompt: 'Do the task' } as WorkflowTask;
    return workflowRuntime(api, '/tmp').turn(run, task, run.definition.executor, new AbortController().signal, () => {});
}
describe('Codex workflow terminal outcomes', () => {
    it('preserves the terminal usage limit and reset time instead of a generic failure', async () => {
        const message = "You've hit your usage limit for GPT-5.3-Codex-Spark. Try again at 3:05 AM.";
        state.events = [{ type: 'task_complete', error: { message, codex_error_info: 'usage_limit_exceeded' } }];
        await expect(turn()).rejects.toThrow(message);
    });
    it('accepts a successful final response after a recoverable error notification', async () => {
        state.events = [{ type: 'error', message: 'Stream disconnected; reconnecting', will_retry: true },
            { type: 'agent_message', message: JSON.stringify({ decision: 'approve', summary: 'Verified', document: '', findings: [] }) },
            { type: 'task_complete' }];
        await expect(turn()).resolves.toMatchObject({ decision: 'approve' });
    });
});
