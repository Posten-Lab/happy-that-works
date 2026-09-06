import * as React from 'react';
// @ts-expect-error The workspace has react-test-renderer without its optional type package.
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const { claudeListModels, codexListModels } = vi.hoisted(() => ({ claudeListModels: vi.fn(), codexListModels: vi.fn() }));
vi.mock('@/sync/ops', () => ({ claudeListModels, codexListModels }));
vi.mock('@/sync/storage', () => ({ useSocketStatus: () => ({ status: 'connected' }) }));
import { useClaudeProviderModels } from './useClaudeProviderModels';
import { mergeProviderModels } from '@/utils/providerModels';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('switches Claude catalogs with the machine and ignores a late response from the old machine', async () => {
    let resolveMac!: (result: unknown) => void;
    claudeListModels.mockImplementation((machine: string) => machine === 'mac'
        ? new Promise(resolve => { resolveMac = resolve; })
        : Promise.resolve({ type: 'success', models: [{ code: 'dell-model', value: 'Dell Claude' }] }));
    const observed: Array<ReturnType<typeof useClaudeProviderModels>> = [];
    function Probe({ machine }: { machine: string }) {
        observed.push(useClaudeProviderModels([machine]));
        return null;
    }
    let renderer!: { update(element: React.ReactElement): void; unmount(): void };
    await act(async () => { renderer = TestRenderer.create(React.createElement(Probe, { machine: 'mac' })); });
    await act(async () => { renderer.update(React.createElement(Probe, { machine: 'dell' })); });
    expect(observed.at(-1)?.map(m => m.code)).toEqual(['dell-model']);
    await act(async () => { resolveMac({ type: 'success', models: [{ code: 'mac-model', value: 'Mac Claude' }] }); });
    expect(observed.at(-1)?.map(m => m.code)).toEqual(['dell-model']);
    expect(codexListModels).not.toHaveBeenCalled();
    act(() => renderer.unmount());
});

it('preserves explicit no-effort support when multiple machines advertise the same model', () => {
    expect(mergeProviderModels([
        [{ code: 'haiku', value: 'Haiku', supportedReasoningEfforts: [] }],
        [{ code: 'haiku', value: 'Haiku', supportedReasoningEfforts: [] }],
    ])[0].supportedReasoningEfforts).toEqual([]);
});

it('keeps unchanged refresh results stable so polling does not reset picker selections', async () => {
    vi.useFakeTimers();
    claudeListModels.mockImplementation(async () => ({ type: 'success', models: [{ code: 'sonnet', value: 'Sonnet' }] }));
    const observed: Array<ReturnType<typeof useClaudeProviderModels>> = [];
    function Probe() {
        observed.push(useClaudeProviderModels(['mac']));
        return null;
    }
    let renderer!: { unmount(): void };
    try {
        await act(async () => { renderer = TestRenderer.create(React.createElement(Probe)); });
        const catalog = observed.at(-1);
        await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
        expect(observed.at(-1)).toBe(catalog);
    } finally {
        act(() => renderer.unmount());
        vi.useRealTimers();
    }
});
