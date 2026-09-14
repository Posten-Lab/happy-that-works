import * as React from 'react';
// @ts-expect-error The workspace has react-test-renderer without its optional type package.
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { codexListModels, claudeListModels, museListModels, useSocketStatus } = vi.hoisted(() => ({ codexListModels: vi.fn(), claudeListModels: vi.fn(), museListModels: vi.fn(), useSocketStatus: vi.fn() }));
vi.mock('@/sync/ops', () => ({ codexListModels, claudeListModels, museListModels }));
vi.mock('@/sync/storage', () => ({ useSocketStatus }));
import { useMachineModelCatalog } from './useMachineModelCatalog';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const success = { type: 'success', models: [{ code: 'model', value: 'Model' }] };
let current: ReturnType<typeof useMachineModelCatalog>;
let renderer: { update(element: React.ReactElement): void; unmount(): void } | undefined;
function Probe({ machine = 'mac', provider = 'codex' }: { machine?: string | null; provider?: 'codex' | 'claude' | 'muse' }) { current = useMachineModelCatalog(machine, provider); return null; }
async function render(machine: string | null = 'mac', provider: 'codex' | 'claude' | 'muse' = 'codex') {
    await act(async () => { if (renderer) renderer.update(React.createElement(Probe, { machine, provider })); else renderer = TestRenderer.create(React.createElement(Probe, { machine, provider })); });
}
beforeEach(() => { codexListModels.mockReset(); claudeListModels.mockReset(); museListModels.mockReset(); useSocketStatus.mockReturnValue({ status: 'connected' }); });
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); });
describe('machine catalog setup feedback', () => {
    it.each(['rpc-error', 'empty', 'rejection'])('exposes %s and permits a successful explicit retry', async failure => {
        if (failure === 'rejection') codexListModels.mockRejectedValueOnce(new Error('RPC failed'));
        else codexListModels.mockResolvedValueOnce(failure === 'empty' ? { type: 'success', models: [] } : { type: 'error', errorMessage: 'RPC failed' });
        codexListModels.mockResolvedValueOnce(success);
        await render(); expect(current.status).toBe('error'); expect(current.error).not.toBe('');
        await act(async () => current.retry());
        expect(current.status).toBe('ready'); expect(current.models).toEqual(success.models);
    });
    it('bounds a hung request and ignores its late response after retry', async () => {
        vi.useFakeTimers(); let finish!: (x: typeof success) => void;
        codexListModels.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(success);
        await render(); expect(current.status).toBe('loading');
        await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
        expect(current.status).toBe('error'); expect(current.error).toContain('daemon');
        await act(async () => current.retry());
        await act(async () => finish({ type: 'success', models: [{ code: 'stale', value: 'Stale' }] }));
        expect(current.models).toEqual(success.models);
    });
    it('ignores old-machine results when selection changes', async () => {
        let finish!: (x: typeof success) => void;
        codexListModels.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(success);
        await render('mac'); await render('dell');
        await act(async () => finish({ type: 'success', models: [{ code: 'old', value: 'Old' }] }));
        expect(current.status).toBe('ready'); expect(current.models).toEqual(success.models);
    });
    it('discards stale provider results and discovers each selected provider', async () => {
        let finish!: (x: typeof success) => void;
        codexListModels.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        claudeListModels.mockResolvedValue({ type: 'success', models: [{ code: 'sonnet', value: 'Sonnet' }] });
        museListModels.mockResolvedValue({ type: 'success', models: [{ code: 'code', value: 'Muse Code' }] });
        await render('mac', 'codex'); await render('mac', 'claude');
        await act(async () => finish(success));
        expect(current.models[0].code).toBe('sonnet');
        await render('mac', 'muse'); expect(current.models[0].code).toBe('code');
    });
    it('waits for connection, discovers on reconnect, and stops when no eligible machine exists', async () => {
        useSocketStatus.mockReturnValue({ status: 'disconnected' }); codexListModels.mockResolvedValue(success);
        await render(); expect(current.status).toBe('disconnected'); expect(codexListModels).not.toHaveBeenCalled();
        useSocketStatus.mockReturnValue({ status: 'connected' }); await render(); expect(current.status).toBe('ready');
        await render(null); expect(current.status).toBe('idle'); expect(current.models).toEqual([]);
    });
});
