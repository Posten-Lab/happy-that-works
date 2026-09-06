import * as React from 'react';
// @ts-expect-error Optional test-renderer types are not installed in this workspace.
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ProviderUsageSnapshot } from '@ahmadposten/talos-wire';

const context = vi.hoisted(() => ({
    machines: [{ id: 'mac', active: true, metadata: { host: 'Mac' } }],
    socket: 'connected', token: 'test-account-a', focused: true,
    read: vi.fn(), appState: 'active', listener: null as null | (() => void),
}));
vi.mock('@/sync/storage', () => ({
    useAllMachines: () => context.machines, useSocketStatus: () => ({ status: context.socket }),
}));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ credentials: { token: context.token } }) }));
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => context.focused }));
vi.mock('react-native', () => ({
    Platform: { OS: 'ios' },
    AppState: { get currentState() { return context.appState; }, addEventListener: (_: string, listener: () => void) => {
        context.listener = listener; return { remove: () => { context.listener = null; } };
    } },
}));
vi.mock('@/sync/providerUsage', async importOriginal => ({
    ...await importOriginal<typeof import('@/sync/providerUsage')>(), readProviderUsage: context.read,
}));
vi.mock('@/sync/apiSocket', () => ({ apiSocket: {} }));
import { useProviderUsage } from './useProviderUsage';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Result = ReturnType<typeof useProviderUsage>;
let result: Result;
let renderer: { update(element: React.ReactElement): void; unmount(): void } | undefined;
function Probe() { result = useProviderUsage(); return null; }
function snapshot(provider: 'claude' | 'codex', checkedAt = Date.now()): ProviderUsageSnapshot {
    return { provider, status: 'ok', account: { id: 'account', label: 'Account' }, checkedAt,
        dataAsOf: checkedAt, freshness: 'live', windows: [], balances: [] };
}
async function mount() { await act(async () => { renderer = TestRenderer.create(React.createElement(Probe)); }); }
async function rerender() { await act(async () => renderer!.update(React.createElement(Probe))); }
beforeEach(() => {
    vi.useFakeTimers();
    context.machines = [{ id: 'mac', active: true, metadata: { host: 'Mac' } }];
    context.socket = 'connected'; context.token = 'test-account-a'; context.focused = true; context.appState = 'active';
    context.read.mockReset().mockImplementation(async (_: string, provider: 'claude' | 'codex') => snapshot(provider));
});
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; vi.useRealTimers(); });

it('reads both accounts independently, skips healthy bootstrap retries and stops polling in background', async () => {
    await mount();
    expect(context.read).toHaveBeenCalledTimes(2);
    expect(result.entries).toHaveLength(2);
    expect(result.refreshing).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(context.read).toHaveBeenCalledTimes(2);
    await act(async () => { context.appState = 'background'; context.listener?.(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600_000); });
    expect(context.read).toHaveBeenCalledTimes(2);
});

it('preserves and marks the last snapshot stale after a failed refresh', async () => {
    await mount();
    context.read.mockRejectedValue(new Error('Machine offline'));
    await act(async () => result.refresh());
    expect(result.entries[0].snapshot?.freshness).toBe('stale');
    expect(result.entries[0].error).toBe('Machine offline');
    expect(result.refreshing).toBe(false);
});

it('ignores late responses from an old Talos login and does not show its cached account', async () => {
    const pending: Array<(snapshot: ProviderUsageSnapshot) => void> = [];
    context.read.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    await mount();
    context.token = 'test-account-b';
    await rerender();
    expect(result.entries.every(entry => entry.snapshot === null)).toBe(true);
    await act(async () => { pending[0](snapshot('codex')); pending[1](snapshot('claude')); });
    expect(result.entries.every(entry => entry.snapshot === null)).toBe(true);
});

it('does not call offline machines and clears data when a machine is removed', async () => {
    context.machines[0].active = false;
    await mount();
    expect(context.read).not.toHaveBeenCalled();
    expect(result.entries.every(entry => !entry.online && !entry.refreshing)).toBe(true);
    context.machines = [];
    await rerender();
    expect(result.entries).toHaveLength(0);
});

it('refreshes shortly after the earliest known quota reset', async () => {
    const reset = Date.now() + 20_000;
    context.read.mockImplementation(async (_: string, provider: 'claude' | 'codex') => ({
        ...snapshot(provider), windows: [{ id: 'weekly', label: 'Weekly', usedPercent: 95,
            remainingPercent: 5, resetsAt: reset, durationSeconds: 604800 }],
    }));
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(21_000); });
    expect(context.read).toHaveBeenCalledTimes(4);
    expect(context.read).toHaveBeenLastCalledWith('mac', 'claude', true);
});

it('defers a manual refresh until retryAt and retains the current reading in the meantime', async () => {
    context.read.mockImplementation(async (_: string, provider: 'claude' | 'codex') => ({
        ...snapshot(provider), retryAt: Date.now() + 30_000,
    }));
    await mount();
    await act(async () => result.refresh());
    expect(context.read).toHaveBeenCalledTimes(2);
    expect(result.entries.every(entry => entry.snapshot?.status === 'ok' && !entry.refreshing)).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_100); });
    expect(context.read).toHaveBeenCalledTimes(4);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(context.read).toHaveBeenCalledTimes(4);
});
