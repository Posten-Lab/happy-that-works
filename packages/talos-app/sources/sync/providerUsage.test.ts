import { describe, expect, it, vi } from 'vitest';
import type { ProviderUsageSnapshot } from '@ahmadposten/talos-wire';
const { machineRPC } = vi.hoisted(() => ({ machineRPC: vi.fn() }));
vi.mock('./apiSocket', () => ({ apiSocket: { machineRPC } }));
import { mergeProviderUsageEntries, readProviderUsage, type ProviderUsageEntry } from './providerUsage';

function snapshot(overrides: Partial<ProviderUsageSnapshot> = {}): ProviderUsageSnapshot {
    return {
        provider: 'codex', status: 'ok', account: { id: 'account-a', label: 'Pro' },
        checkedAt: 100, dataAsOf: 100, freshness: 'live',
        windows: [{ id: 'weekly', label: 'Weekly', usedPercent: 27, remainingPercent: 73,
            resetsAt: 200, durationSeconds: 604800 }], balances: [], ...overrides,
    };
}
function entry(machineId: string, overrides: Partial<ProviderUsageEntry> = {}): ProviderUsageEntry {
    return { key: `${machineId}:codex`, provider: 'codex', machineId, machineIds: [machineId],
        machineLabel: machineId, online: true, refreshing: false, snapshot: snapshot(), ...overrides };
}

describe('provider account usage transport', () => {
    it('uses bounded encrypted machine RPC and validates the requested provider', async () => {
        machineRPC.mockResolvedValueOnce(snapshot());
        expect((await readProviderUsage('mac', 'codex', true)).windows[0].remainingPercent).toBe(73);
        expect(machineRPC).toHaveBeenLastCalledWith('mac', 'provider-usage', { provider: 'codex', refresh: true }, 30_000);
        machineRPC.mockResolvedValueOnce(snapshot({ provider: 'claude' }));
        await expect(readProviderUsage('mac', 'codex')).rejects.toThrow('could not provide usage data');
    });
    it('rejects malformed numeric data and gives old daemons actionable feedback', async () => {
        machineRPC.mockResolvedValueOnce({ ...snapshot(), checkedAt: 'yesterday' });
        await expect(readProviderUsage('mac', 'codex')).rejects.toThrow('could not provide usage data');
        machineRPC.mockRejectedValueOnce(new Error('RPC method not available'));
        await expect(readProviderUsage('mac', 'codex')).rejects.toThrow('Update Talos');
    });
});

describe('account scope', () => {
    it('deduplicates the same account on two machines without adding its quotas', () => {
        const result = mergeProviderUsageEntries([
            entry('mac'), entry('linux', { snapshot: snapshot({ checkedAt: 150 }) }),
        ]);
        expect(result).toHaveLength(1);
        expect(result[0].snapshot?.windows[0].remainingPercent).toBe(73);
        expect(result[0].snapshot?.checkedAt).toBe(150);
        expect(result[0].machineIds).toEqual(['mac', 'linux']);
    });
    it('groups failed lookups by provider without inventing a shared account', () => {
        const result = mergeProviderUsageEntries([
            entry('mac', { snapshot: null, error: 'Update Talos' }),
            entry('dell', { snapshot: null, error: 'Reconnect' }),
            entry('claude', { provider: 'claude', snapshot: null }),
        ]);
        expect(result).toHaveLength(2);
        expect(result[0].snapshot).toBeNull();
        expect(result[0].sources?.map(source => source.message)).toEqual(['Update Talos', 'Reconnect']);
        expect(result[0].machineIds).toEqual(['mac', 'dell']);
    });
    it('keeps distinct or unidentified accounts and different providers separate', () => {
        const result = mergeProviderUsageEntries([
            entry('mac'), entry('other', { snapshot: snapshot({ account: { id: 'account-b', label: 'Pro' } }) }),
            entry('unknown', { snapshot: snapshot({ account: null }) }),
            entry('claude', { provider: 'claude', snapshot: snapshot({ provider: 'claude' }) }),
        ]);
        expect(result).toHaveLength(4);
    });
    it('keeps a successful read when another machine has a failed refresh of the same account', () => {
        const result = mergeProviderUsageEntries([
            entry('mac'), entry('linux', { snapshot: snapshot({ checkedAt: 150, freshness: 'stale' }), error: 'Offline' }),
        ]);
        expect(result[0].snapshot?.freshness).toBe('live');
        expect(result[0].error).toBeUndefined();
    });
    it('never upgrades an offline saved reading to live because another machine is connected', () => {
        const result = mergeProviderUsageEntries([
            entry('mac', { online: false, snapshot: snapshot({ checkedAt: 200 }) }),
            entry('linux', { snapshot: snapshot({ checkedAt: 150, freshness: 'stale' }), error: 'Refresh failed' }),
        ]);
        expect(result[0].online).toBe(true);
        expect(result[0].snapshot?.freshness).toBe('stale');
        expect(result[0].error).toBe('Refresh failed');
    });
});
