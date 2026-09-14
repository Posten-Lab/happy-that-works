import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
vi.mock('expo-crypto', () => ({ randomUUID }));
import type { Machine } from '@/sync/storageTypes';
import { createStarterTeam, workflowDraft } from './setup';
import { editableWorkflow } from './builder';
import { inspectWorkflowStart, prepareWorkflowStart, requiredWorkflowVersion, workflowMachineIssue, workflowStartMethod, settleWorkflowStart } from './launch';

const definition = () => workflowDraft(createStarterTeam({ code: 'model', value: 'Model' }, null, [], randomUUID), randomUUID());
const machine = (version = 3, active = true, homeDir = '/Users/test'): Machine => ({ id: 'machine-one', active, metadata: { workflows: { version }, homeDir } } as Machine);

describe('workflow launch safety', () => {
    it('gates legacy, editable and multi-provider starts against the selected machine capability', () => {
        const legacy = definition();
        const editable = editableWorkflow(legacy);
        const mixed = structuredClone(editable); mixed.steps![0].agents[0].agent.provider = 'claude';
        expect(requiredWorkflowVersion(legacy)).toBe(1);
        expect(requiredWorkflowVersion(editable)).toBe(2);
        expect(requiredWorkflowVersion(mixed)).toBe(3);
        expect(workflowStartMethod(legacy)).toBe('start');
        expect(workflowStartMethod(editable)).toBe('start-v2');
        expect(workflowStartMethod(mixed)).toBe('start-v2');
        const mixedLegacy = structuredClone(legacy); mixedLegacy.executor.agent.provider = 'claude';
        expect(workflowStartMethod(mixedLegacy)).toBe('start-v2');
        expect(workflowMachineIssue(legacy, machine(1))).toBeNull();
        expect(workflowMachineIssue(editable, machine(1))).toContain('Update');
        expect(workflowMachineIssue(mixed, machine(2))).toContain('Update');
        expect(workflowMachineIssue(mixed, machine(3))).toBeNull();
        expect(workflowMachineIssue(legacy, machine(3, false))).toContain('offline');
        expect(workflowMachineIssue(legacy, null)).toContain('Choose a machine');
    });
    it('expands the shared project picker’s home-relative paths on the selected machine', () => {
        const request = prepareWorkflowStart({ id: 'request-id', definition: definition(), task: '  Deliver the fix  ', directory: ' ~/work/project ', machine: machine() });
        expect(request).toMatchObject({ id: 'request-id', machineId: 'machine-one', directory: '/Users/test/work/project', task: 'Deliver the fix' });
        expect(prepareWorkflowStart({ ...request, directory: '~/project', machine: machine(3, true, 'C:\\Users\\test') }).directory).toBe('C:\\Users\\test\\project');
    });
    it('rejects incomplete or ambiguous requests before a start receipt can be persisted', () => {
        const input = { id: 'request-id', definition: definition(), task: 'Fix', directory: '/project', machine: machine() };
        expect(() => prepareWorkflowStart({ ...input, task: ' ' })).toThrow('Describe');
        expect(() => prepareWorkflowStart({ ...input, directory: 'project' })).toThrow('absolute');
        expect(() => prepareWorkflowStart({ ...input, directory: '~/project', machine: { ...input.machine, metadata: null } })).toThrow('Update');
        expect(() => prepareWorkflowStart({ ...input, directory: '~/project', machine: machine(3, true, '') })).toThrow('absolute');
    });
    it('freezes the entire workflow configuration for an in-flight request', () => {
        const source = editableWorkflow(definition());
        const request = prepareWorkflowStart({ id: 'request-id', definition: source, task: 'Fix', directory: '/project', machine: machine() });
        source.name = 'Changed elsewhere'; source.steps![0].agents[0].agent.model = 'another-model';
        expect(request.definition.name).not.toBe(source.name);
        expect(request.definition.steps![0].agents[0].agent.model).toBe('model');
    });
    it('checks the original receipt machine and fails closed for an unknown start state', async () => {
        const rpc = vi.fn().mockResolvedValue({ state: 'created' });
        const receipt = { id: 'retained-id', machineId: 'original-machine' };
        await expect(inspectWorkflowStart(receipt, rpc)).resolves.toBe('created');
        expect(rpc).toHaveBeenCalledWith('original-machine', 'start-status', { id: 'retained-id' });
        rpc.mockResolvedValueOnce({ state: 'absent' }); await expect(inspectWorkflowStart(receipt, rpc)).resolves.toBe('absent');
        rpc.mockResolvedValueOnce({ state: 'starting' }); await expect(inspectWorkflowStart(receipt, rpc)).resolves.toBe('starting');
        rpc.mockResolvedValueOnce({ state: 'maybe' }); await expect(inspectWorkflowStart(receipt, rpc)).rejects.toThrow('unknown start status');
        rpc.mockRejectedValueOnce(new Error('offline')); await expect(inspectWorkflowStart(receipt, rpc)).rejects.toThrow('offline');
    });
});

describe('late workflow responses', () => {
    it('preserves launch B when a deferred response for launch A arrives after A was reconciled', async () => {
        const A = { id: 'launch-a', machineId: 'machine-a' }, B = { id: 'launch-b', machineId: 'machine-b' };
        let receipt: typeof A | null = A;
        const cleared = vi.fn(), open = vi.fn();
        const callbacks = { read: () => receipt, save: (value: typeof A | null) => { receipt = value; }, cleared, focused: () => true, open };
        let resolveA!: () => void;
        const delayedA = new Promise<void>(resolve => { resolveA = resolve; }).then(() => settleWorkflowStart(A, 'created', callbacks));
        expect(settleWorkflowStart(A, 'created', callbacks)).toBe(true);
        receipt = B;
        resolveA();
        await expect(delayedA).resolves.toBe(false);
        expect(receipt).toEqual(B);
        expect(cleared).toHaveBeenCalledTimes(1);
        expect(open).toHaveBeenCalledExactlyOnceWith(A);
    });
    it('does not navigate from a screen that lost focus while its start was awaiting a result', async () => {
        const request = { id: 'launch-a', machineId: 'machine-a' };
        let receipt: typeof request | null = request, focused = true;
        const open = vi.fn();
        let resolve!: () => void;
        const delayed = new Promise<void>(done => { resolve = done; }).then(() => settleWorkflowStart(request, 'created', {
            read: () => receipt, save: value => { receipt = value; }, cleared: () => {}, focused: () => focused, open,
        }));
        focused = false; resolve(); await delayed;
        expect(receipt).toBeNull(); expect(open).not.toHaveBeenCalled();
    });
    it('matches both receipt ID and machine before clearing an absent start', () => {
        const request = { id: 'same-id', machineId: 'machine-a' }, save = vi.fn(), cleared = vi.fn(), open = vi.fn();
        expect(settleWorkflowStart(request, 'absent', { read: () => ({ ...request, machineId: 'machine-b' }), save, cleared, focused: () => true, open })).toBe(false);
        expect(save).not.toHaveBeenCalled(); expect(cleared).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
    });
});
