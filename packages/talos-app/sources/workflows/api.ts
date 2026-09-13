import { storage } from '@/sync/storage';
import { apiSocket } from '@/sync/apiSocket';
import { WorkflowRunSchema, type WorkflowRun, type WorkflowStage } from '@ahmadposten/talos-wire';
export type RunSummary = { id: string; name: string; task: string; status: WorkflowRun['status']; stage: WorkflowStage; updatedAt: number; machineId: string };
export async function workflowRPC<T>(machine: string, method: string, data: unknown): Promise<T> {
    const version = storage.getState().machines[machine]?.metadata?.workflows?.version ?? 1;
    const rpcMethod = version >= 2 && ['list', 'get', 'task', 'action'].includes(method) ? `${method}-v2` : method;
    const result = await apiSocket.machineRPC<T & { error?: string } , unknown>(machine, `workflow-${rpcMethod}`, data, 90000);
    if (result && typeof result === 'object' && 'error' in result) throw new Error(String(result.error));
    return result;
}
export async function loadWorkflowRun(machine: string, id: string) { return WorkflowRunSchema.parse(await workflowRPC(machine, 'get', { id })); }
