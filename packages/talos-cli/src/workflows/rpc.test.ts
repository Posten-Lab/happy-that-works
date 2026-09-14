import { describe, it, expect, vi } from 'vitest';
import { registerWorkflowHandlers } from './rpc';
import { definition } from './testFixture';
import type { WorkflowCoordinator } from './coordinator';
describe('versioned workflow RPC boundary', () => {
    it('hides custom runs from old clients and refuses old start/control/detail calls before mutation', async () => {
        const handlers = new Map<string, (p: any) => any>();
        const runs = [{ id: 'old', definition: definition() }, { id: 'custom', definition: { steps: [] } }];
        const coordinator = { list: () => runs, get: (id: string) => runs.find(r => r.id === id), view: (id: string) => runs.find(r => r.id === id), start: vi.fn(), action: vi.fn(), task: vi.fn() };
        registerWorkflowHandlers({ registerHandler: (name, handler) => { handlers.set(name, handler); } }, coordinator as unknown as WorkflowCoordinator);
        expect(handlers.get('workflow-list')!({}).map((r: any) => r.id)).toEqual(['old']);
        expect(handlers.get('workflow-list-v2')!({})).toHaveLength(2);
        expect(() => handlers.get('workflow-get')!({ id: 'custom' })).toThrow('Update');
        expect(() => handlers.get('workflow-task')!({ id: 'custom' })).toThrow('Update');
        await expect(handlers.get('workflow-action')!({ id: 'custom', action: 'resume' })).rejects.toThrow('Update');
        await expect(handlers.get('workflow-start')!({ definition: { steps: [] } })).rejects.toThrow('v2');
        expect(coordinator.action).not.toHaveBeenCalled(); expect(coordinator.start).not.toHaveBeenCalled();
        expect(handlers.get('workflow-get-v2')!({ id: 'custom' })).toEqual(runs[1]);
    });
});

it('isolates multi-provider runs from v1/v2 reads and writes while v3 can inspect them', async () => {
    const handlers = new Map<string, (p: any) => any>();
    const codex = definition(), mixed = definition(); mixed.executor.agent.provider = 'claude';
    const runs = [{ id: 'codex', definition: codex }, { id: 'mixed', definition: mixed }];
    const coordinator = { list: () => runs, get: (id: string) => runs.find(r => r.id === id), view: (id: string) => runs.find(r => r.id === id), start: vi.fn(), action: vi.fn(), task: vi.fn() };
    registerWorkflowHandlers({ registerHandler: (name, handler) => { handlers.set(name, handler); } }, coordinator as unknown as WorkflowCoordinator);
    for (const suffix of ['', '-v2']) {
        expect(handlers.get(`workflow-list${suffix}`)!({}).map((r: any) => r.id)).toEqual(['codex']);
        expect(() => handlers.get(`workflow-get${suffix}`)!({ id: 'mixed' })).toThrow('Update');
        expect(() => handlers.get(`workflow-task${suffix}`)!({ id: 'mixed' })).toThrow('Update');
        await expect(handlers.get(`workflow-action${suffix}`)!({ id: 'mixed', action: 'resume' })).rejects.toThrow('Update');
        await expect(handlers.get(`workflow-start${suffix}`)!({ definition: mixed })).rejects.toThrow();
    }
    for (const suffix of ['', '-v2']) await expect(handlers.get(`workflow-action${suffix}`)!({ id: 'codex', action: 'replace_agent', replacement: { provider: 'claude' } })).rejects.toThrow('Update');
    expect(coordinator.action).not.toHaveBeenCalled(); expect(coordinator.start).not.toHaveBeenCalled();
    expect(handlers.get('workflow-list-v3')!({})).toHaveLength(2);
    expect(handlers.get('workflow-get-v3')!({ id: 'mixed' })).toEqual(runs[1]);
});
