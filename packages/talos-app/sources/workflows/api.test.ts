import { describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ version: 2, rpc: vi.fn(async () => []) }));
vi.mock('@/sync/storage', () => ({ storage: { getState: () => ({ machines: { machine: { metadata: { workflows: { version: state.version } } } } }) } }));
vi.mock('@/sync/apiSocket', () => ({ apiSocket: { machineRPC: state.rpc } }));
import { workflowRPC } from './api';
describe('workflow capability routing', () => {
    it('uses v2 views/actions on upgraded machines while keeping explicit start versions', async () => {
        state.version = 2;
        for (const method of ['list', 'get', 'task', 'action']) { await workflowRPC('machine', method, {}); expect(state.rpc).toHaveBeenLastCalledWith('machine', `workflow-${method}-v2`, {}, 90000); }
        const payload = { definition: { steps: [] } };
        await workflowRPC('machine', 'start-v2', payload); expect(state.rpc).toHaveBeenLastCalledWith('machine', 'workflow-start-v2', payload, 90000);
        await workflowRPC('machine', 'start', {}); expect(state.rpc).toHaveBeenLastCalledWith('machine', 'workflow-start', {}, 90000);
    });
    it('routes mixed providers only to a capable coordinator before any mutation', async () => {
        const payload = { definition: { steps: [{ agents: [{ agent: { provider: 'claude' } }] }] } };
        state.version = 2; state.rpc.mockClear();
        await expect(workflowRPC('machine', 'start-v2', payload)).rejects.toThrow('Update the coordinator');
        expect(state.rpc).not.toHaveBeenCalled();
        state.version = 3;
        await workflowRPC('machine', 'start-v2', payload);
        expect(state.rpc).toHaveBeenLastCalledWith('machine', 'workflow-start-v3', payload, 90000);
        for (const method of ['list', 'get', 'task', 'action']) {
            await workflowRPC('machine', method, {});
            expect(state.rpc).toHaveBeenLastCalledWith('machine', `workflow-${method}-v3`, {}, 90000);
        }
    });
    it('keeps legacy run views usable on a v1 coordinator', async () => {
        state.version = 1; await workflowRPC('machine', 'get', {}); expect(state.rpc).toHaveBeenLastCalledWith('machine', 'workflow-get', {}, 90000);
    });
});
