import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
import type { WorkflowCoordinator } from './coordinator';

/** Old clients cannot see or act on custom runs using an incomplete three-stage rendering. */
export function registerWorkflowHandlers(manager: Pick<RpcHandlerManager, 'registerHandler'>, workflows: WorkflowCoordinator) {
    const requireLegacy = (id: string) => {
        if (workflows.get(id).definition.steps) throw new Error('Update the Talos app to inspect or control this editable workflow.');
    };
    manager.registerHandler('workflow-start-status', (p: { id: string }) => workflows.startStatus(p.id));
    manager.registerHandler('workflow-list', () => workflows.list().filter(run => !workflows.get(run.id).definition.steps));
    manager.registerHandler('workflow-get', (p: { id: string }) => { requireLegacy(p.id); return workflows.view(p.id); });
    manager.registerHandler('workflow-task', (p: { id: string; taskId: string }) => { requireLegacy(p.id); return workflows.task(p.id, p.taskId); });
    manager.registerHandler('workflow-start', async (p: any) => {
        if (p?.definition?.steps) throw new Error('Editable workflow starts require workflow-start-v2.');
        return workflows.view((await workflows.start(p)).id);
    });
    manager.registerHandler('workflow-action', async (p: any) => { requireLegacy(p?.id); return workflows.view((await workflows.action(p)).id); });
    manager.registerHandler('workflow-list-v2', () => workflows.list());
    manager.registerHandler('workflow-get-v2', (p: { id: string }) => workflows.view(p.id));
    manager.registerHandler('workflow-task-v2', (p: { id: string; taskId: string }) => workflows.task(p.id, p.taskId));
    manager.registerHandler('workflow-start-v2', async (p: any) => {
        if (!Array.isArray(p?.definition?.steps)) throw new Error('Editable workflow steps are required.');
        return workflows.view((await workflows.start(p)).id);
    });
    manager.registerHandler('workflow-action-v2', async p => workflows.view((await workflows.action(p)).id));
}
