import * as React from 'react';
// @ts-expect-error The workspace has react-test-renderer without its optional type package.
import TestRenderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { codexListModels } = vi.hoisted(() => ({
    codexListModels: vi.fn(),
}));

vi.mock('@/sync/ops', () => ({ codexListModels }));

import { useCodexProviderModels } from './useCodexProviderModels';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useCodexProviderModels', () => {
    beforeEach(() => {
        codexListModels.mockReset();
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
});
