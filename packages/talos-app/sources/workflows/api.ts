import { storage } from '@/sync/storage';
import { apiSocket } from '@/sync/apiSocket';
import { WorkflowRunSchema, workflowNeedsProviders, type WorkflowRun, type WorkflowStage } from '@ahmadposten/talos-wire';
export type RunSummary = { id: string; name: string; task: string; status: WorkflowRun['status']; stage: WorkflowStage; updatedAt: number; machineId: string };
export async function workflowRPC<T>(machine: string, method: string, data: unknown): Promise<T> {
    const version = storage.getState().machines[machine]?.metadata?.workflows?.version ?? 1;
    const mixed = method === 'start-v2' && workflowNeedsProviders((data as { definition: Parameters<typeof workflowNeedsProviders>[0] }).definition);
    if (mixed && version < 3) throw new Error('Update the coordinator CLI to run multi-provider workflows.');
    const rpcMethod = mixed ? 'start-v3' : version >= 2 && ['list', 'get', 'task', 'action'].includes(method) ? `${method}-v${version >= 3 ? 3 : 2}` : method;
    const result = await apiSocket.machineRPC<T & { error?: string } , unknown>(machine, `workflow-${rpcMethod}`, data, 90000);
    if (result && typeof result === 'object' && 'error' in result) throw new Error(String(result.error));
    return result;
}
export async function loadWorkflowRun(machine: string, id: string) { return WorkflowRunSchema.parse(await workflowRPC(machine, 'get', { id })); }
