import * as React from 'react';
// @ts-expect-error The workspace has react-test-renderer without its optional type package.
import TestRenderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { codexListModels, useSocketStatus } = vi.hoisted(() => ({
    codexListModels: vi.fn(),
    useSocketStatus: vi.fn(),
}));

vi.mock('@/sync/ops', () => ({ codexListModels }));
vi.mock('@/sync/storage', () => ({ useSocketStatus }));

import { useCodexProviderModels } from './useCodexProviderModels';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useCodexProviderModels', () => {
    beforeEach(() => {
        codexListModels.mockReset();
        useSocketStatus.mockReset();
        useSocketStatus.mockReturnValue({ status: 'connected' });
    });

    it('discovers and merges models from all requested machines', async () => {
        codexListModels.mockImplementation(async (machineId: string) => ({
            type: 'success',
            models: machineId === 'mac'
                ? [{ code: 'gpt-6-astra', value: 'GPT-6-Astra', isDefault: true }]
                : [{ code: 'gpt-5.6-sol', value: 'GPT-5.6-Sol' }],
        }));
        const observed: Array<ReturnType<typeof useCodexProviderModels>> = [];

        function Probe() {
            const models = useCodexProviderModels(['dell', 'mac']);
            observed.push(models);
            return null;
        }

        let renderer!: { unmount(): void };
        await act(async () => {
            renderer = TestRenderer.create(React.createElement(Probe));
        });

        expect(codexListModels.mock.calls.map(([machineId]) => machineId)).toEqual(['dell', 'mac']);
        expect(observed.at(-1)?.map((model) => model.code)).toEqual(['gpt-5.6-sol', 'gpt-6-astra']);

        act(() => renderer.unmount());
    });

    it('does not query machines when discovery is disabled', async () => {
        function Probe() {
            useCodexProviderModels(['mac'], false);
            return null;
        }

        let renderer!: { unmount(): void };
        await act(async () => {
            renderer = TestRenderer.create(React.createElement(Probe));
        });

        expect(codexListModels).not.toHaveBeenCalled();
        act(() => renderer.unmount());
    });

    it('retries immediately when the native socket finishes connecting', async () => {
        let status = 'connecting';
        useSocketStatus.mockImplementation(() => ({ status }));
        codexListModels.mockResolvedValue({
            type: 'success',
            models: [{ code: 'gpt-6-astra', value: 'GPT-6-Astra' }],
        });

        function Probe() {
            useCodexProviderModels(['mac']);
            return null;
        }

        let renderer!: { update(element: React.ReactElement): void; unmount(): void };
        await act(async () => {
            renderer = TestRenderer.create(React.createElement(Probe));
        });
        expect(codexListModels).not.toHaveBeenCalled();

        status = 'connected';
        await act(async () => {
            renderer.update(React.createElement(Probe));
        });
        expect(codexListModels).toHaveBeenCalledWith('mac');

        act(() => renderer.unmount());
    });

    it('shows a responsive machine without waiting for another machine', async () => {
        let resolveDell!: (value: { type: 'success'; models: never[] }) => void;
        codexListModels.mockImplementation((machineId: string) => {
            if (machineId === 'dell') {
                return new Promise((resolve) => { resolveDell = resolve; });
            }
            return Promise.resolve({
                type: 'success',
                models: [{ code: 'gpt-6-astra', value: 'GPT-6-Astra' }],
            });
        });
        const observed: Array<ReturnType<typeof useCodexProviderModels>> = [];

        function Probe() {
            observed.push(useCodexProviderModels(['dell', 'mac']));
            return null;
        }

        let renderer!: { unmount(): void };
        await act(async () => {
            renderer = TestRenderer.create(React.createElement(Probe));
        });

        expect(observed.at(-1)?.map((model) => model.code)).toEqual(['gpt-6-astra']);
        resolveDell({ type: 'success', models: [] });
        act(() => renderer.unmount());
    });

    it('retries quickly when native bootstrap makes the first RPC fail', async () => {
        vi.useFakeTimers();
        codexListModels
            .mockResolvedValueOnce({ type: 'error', errorMessage: 'Machine encryption not found' })
            .mockResolvedValueOnce({
                type: 'success',
                models: [{ code: 'gpt-6-astra', value: 'GPT-6-Astra' }],
            });
        const observed: Array<ReturnType<typeof useCodexProviderModels>> = [];

        function Probe() {
            observed.push(useCodexProviderModels(['mac']));
            return null;
        }

        let renderer!: { unmount(): void };
        await act(async () => {
            renderer = TestRenderer.create(React.createElement(Probe));
        });
        expect(observed.at(-1)).toBeNull();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(3_000);
        });
        expect(observed.at(-1)?.map((model) => model.code)).toEqual(['gpt-6-astra']);

        act(() => renderer.unmount());
        vi.useRealTimers();
    });
});
