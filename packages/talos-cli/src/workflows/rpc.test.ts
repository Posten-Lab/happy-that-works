import { describe, it, expect, vi } from 'vitest';
import { registerWorkflowHandlers } from './rpc';
import type { WorkflowCoordinator } from './coordinator';
describe('versioned workflow RPC boundary', () => {
    it('hides custom runs from old clients and refuses old start/control/detail calls before mutation', async () => {
        const handlers = new Map<string, (p: any) => any>();
        const runs = [{ id: 'old', definition: {} }, { id: 'custom', definition: { steps: [] } }];
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
