import { workflowNeedsProviders } from '@ahmadposten/talos-wire';
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
import type { WorkflowCoordinator } from './coordinator';

/** Old clients cannot see or act on custom runs using an incomplete three-stage rendering. */
export function registerWorkflowHandlers(manager: Pick<RpcHandlerManager, 'registerHandler'>, workflows: WorkflowCoordinator) {
    const requireCodex = (id: string) => { if (workflowNeedsProviders(workflows.get(id).definition)) throw new Error('Update Talos to inspect or control this multi-provider workflow.'); };
    const requireLegacy = (id: string) => {
        requireCodex(id);
        if (workflows.get(id).definition.steps) throw new Error('Update the Talos app to inspect or control this editable workflow.');
    };
    manager.registerHandler('workflow-start-status', (p: { id: string }) => workflows.startStatus(p.id));
    manager.registerHandler('workflow-list', () => workflows.list().filter(run => !workflows.get(run.id).definition.steps && !workflowNeedsProviders(workflows.get(run.id).definition)));
    manager.registerHandler('workflow-get', (p: { id: string }) => { requireLegacy(p.id); return workflows.view(p.id); });
    manager.registerHandler('workflow-task', (p: { id: string; taskId: string }) => { requireLegacy(p.id); return workflows.task(p.id, p.taskId); });
    manager.registerHandler('workflow-start', async (p: any) => {
        if (p?.definition?.steps || p?.definition && workflowNeedsProviders(p.definition)) throw new Error('Editable workflow starts require workflow-start-v2.');
        return workflows.view((await workflows.start(p)).id);
    });
    manager.registerHandler('workflow-action', async (p: any) => { requireLegacy(p?.id); if (p?.replacement && p.replacement.provider !== 'codex') throw new Error('Update Talos to replace a participant with another provider.'); return workflows.view((await workflows.action(p)).id); });
    manager.registerHandler('workflow-list-v2', () => workflows.list().filter(run => !workflowNeedsProviders(workflows.get(run.id).definition)));
    manager.registerHandler('workflow-get-v2', (p: { id: string }) => { requireCodex(p.id); return workflows.view(p.id); });
    manager.registerHandler('workflow-task-v2', (p: { id: string; taskId: string }) => { requireCodex(p.id); return workflows.task(p.id, p.taskId); });
    manager.registerHandler('workflow-start-v2', async (p: any) => {
        if (p?.definition && workflowNeedsProviders(p.definition)) throw new Error('Multi-provider workflow starts require workflow-start-v3.');
        if (!Array.isArray(p?.definition?.steps)) throw new Error('Editable workflow steps are required.');
        return workflows.view((await workflows.start(p)).id);
    });
    manager.registerHandler('workflow-action-v2', async p => { requireCodex(p?.id); if (p?.replacement && p.replacement.provider !== 'codex') throw new Error('Update Talos to replace a participant with another provider.'); return workflows.view((await workflows.action(p)).id); });
    manager.registerHandler('workflow-list-v3', () => workflows.list());
    manager.registerHandler('workflow-get-v3', (p: { id: string }) => workflows.view(p.id));
    manager.registerHandler('workflow-task-v3', (p: { id: string; taskId: string }) => workflows.task(p.id, p.taskId));
    manager.registerHandler('workflow-start-v3', async (p: any) => workflows.view((await workflows.start(p)).id));
    manager.registerHandler('workflow-action-v3', async p => workflows.view((await workflows.action(p)).id));
}
