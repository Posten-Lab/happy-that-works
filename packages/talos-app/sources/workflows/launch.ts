import { workflowNeedsProviders, type WorkflowDefinition } from '@ahmadposten/talos-wire';
import { resolveAbsolutePath } from '@/utils/pathUtils';
import type { Machine } from '@/sync/storageTypes';

export type WorkflowStartRequest = { id: string; definition: WorkflowDefinition; task: string; directory: string; machineId: string };
export type PendingWorkflowStart = Pick<WorkflowStartRequest, 'id' | 'machineId'>;

export function requiredWorkflowVersion(definition: WorkflowDefinition): number {
    return workflowNeedsProviders(definition) ? 3 : definition.steps ? 2 : 1;
}

export function workflowStartMethod(definition: WorkflowDefinition): 'start' | 'start-v2' {
    // workflowRPC promotes multi-provider start-v2 requests to the V3 endpoint.
    return definition.steps || workflowNeedsProviders(definition) ? 'start-v2' : 'start';
}

export function workflowMachineIssue(definition: WorkflowDefinition, machine?: Machine | null): string | null {
    if (!machine) return 'Choose a machine to run this workflow. Connect one from Settings if none are connected.';
    if (!machine.active) return 'This machine is offline. Start its Talos daemon, or choose an online machine.';
    if ((machine.metadata?.workflows?.version ?? 0) < requiredWorkflowVersion(definition)) return 'Update Talos on this machine and restart its daemon to run this workflow, or choose an up-to-date machine.';
    return null;
}

export function prepareWorkflowStart(input: { id: string; definition: WorkflowDefinition; task: string; directory: string; machine: Machine }): WorkflowStartRequest {
    const issue = workflowMachineIssue(input.definition, input.machine);
    if (issue) throw new Error(issue);
    const task = input.task.trim();
    if (!task) throw new Error('Describe what you want the workflow to do.');
    const directory = resolveAbsolutePath(input.directory.trim(), input.machine.metadata?.homeDir);
    if (!directory || !(/^(\/|[a-z]:[\\/]|\\\\)/i.test(directory))) throw new Error('Choose an absolute project folder using Project. Paths beginning with ~/ work when the machine shares its home folder.');
    return { id: input.id, definition: structuredClone(input.definition), task, directory, machineId: input.machine.id };
}

/** A retained receipt always reconciles on its original machine, even after selection or navigation changes. */
export async function inspectWorkflowStart(receipt: PendingWorkflowStart, rpc: (machine: string, method: string, data: unknown) => Promise<unknown>): Promise<'created' | 'absent' | 'starting'> {
    const result = await rpc(receipt.machineId, 'start-status', { id: receipt.id }) as { state?: unknown } | null;
    if (result?.state === 'created' || result?.state === 'absent' || result?.state === 'starting') return result.state;
    throw new Error('The machine returned an unknown start status. Keep this request and check again.');
}

export function sameWorkflowStart(a: PendingWorkflowStart | null, b: PendingWorkflowStart | null): boolean {
    return !!a && !!b && a.id === b.id && a.machineId === b.machineId;
}

/** A late response may resolve only its own receipt; a newer launch belongs to another screen. */
export function settleWorkflowStart(request: PendingWorkflowStart, outcome: 'created' | 'absent', callbacks: {
    read: () => PendingWorkflowStart | null;
    save: (value: PendingWorkflowStart | null) => void;
    cleared: () => void;
    focused: () => boolean;
    open: (request: PendingWorkflowStart) => void;
}): boolean {
    if (!sameWorkflowStart(callbacks.read(), request)) return false;
    callbacks.save(null);
    callbacks.cleared();
    if (outcome === 'created' && callbacks.focused()) callbacks.open(request);
    return true;
}
