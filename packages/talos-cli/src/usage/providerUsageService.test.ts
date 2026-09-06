import { describe, expect, it, vi } from 'vitest';
import type { ProviderUsageSnapshot } from '@ahmadposten/talos-wire';
import { emptyUsage } from './normalizeUsage';
import { ProviderUsageService } from './providerUsageService';
import type { UsageAdapter } from './providerUsageAdapters';

function fixture() {
    let now = 1_000_000, account = 'alice';
    const read = vi.fn(async (): Promise<ProviderUsageSnapshot> => ({ ...emptyUsage('claude', 'ok', now), account: { id: account, label: 'Claude Max' }, freshness: 'provider_cache_possible' }));
    const adapter: UsageAdapter = vi.fn(async (resolve) => resolve(account || undefined, read));
    const service = new ProviderUsageService({ claude: adapter, codex: adapter }, () => now);
    return { service, read, adapter, advance: (amount: number) => { now += amount; }, account: (value: string) => { account = value; } };
}

describe('provider usage request caching', () => {
    it('checks identity on each request, caches normal reads and bounds manual refreshes', async () => {
        const f = fixture();
        const original = await f.service.read({ provider: 'claude' });
        f.advance(1000);
        const cached = await f.service.read({ provider: 'claude', refresh: true });
        expect(cached).toMatchObject({ freshness: 'cached', checkedAt: original.checkedAt, dataAsOf: null });
        expect(f.read).toHaveBeenCalledTimes(1);
        expect(f.adapter).toHaveBeenCalledTimes(2);
        f.advance(30_000);
        await f.service.read({ provider: 'claude', refresh: true });
        expect(f.read).toHaveBeenCalledTimes(2);
    });

    it('never serves an old account snapshot after an account switch or identity loss', async () => {
        const f = fixture();
        await f.service.read({ provider: 'claude' });
        f.account('bob');
        const throttled = await f.service.read({ provider: 'claude', refresh: true });
        expect(throttled.status).toBe('unavailable');
        expect(throttled.account).toBeNull();
        f.advance(30_000);
        const bob = await f.service.read({ provider: 'claude' });
        expect(bob.account?.id).toBe('bob');
        f.account('');
        const unknown = await f.service.read({ provider: 'claude' });
        expect(unknown.account).toBeNull();
        expect(unknown.windows).toEqual([]);
    });

    it('marks a failed refresh stale only after the current account was verified', async () => {
        const f = fixture();
        const original = await f.service.read({ provider: 'claude' });
        f.advance(31_000);
        f.read.mockRejectedValueOnce(new Error('network failure with private@example.com'));
        const stale = await f.service.read({ provider: 'claude', refresh: true });
        expect(stale).toMatchObject({ freshness: 'stale', checkedAt: original.checkedAt });
        expect(JSON.stringify(stale)).not.toContain('private@example.com');
        f.account('bob');
        f.advance(31_000);
        f.read.mockRejectedValueOnce(new Error('network failure'));
        expect((await f.service.read({ provider: 'claude', refresh: true })).status).toBe('unavailable');
    });

    it('deduplicates overlapping requests and releases the in-flight entry', async () => {
        const f = fixture();
        let finish!: (value: ProviderUsageSnapshot) => void;
        f.read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        const first = f.service.read({ provider: 'claude' });
        const second = f.service.read({ provider: 'claude', refresh: true });
        finish(emptyUsage('claude', 'ok'));
        expect(await first).toEqual(await second);
        expect(f.adapter).toHaveBeenCalledTimes(1);
        await f.service.read({ provider: 'claude' });
        expect(f.adapter).toHaveBeenCalledTimes(2);
    });

    it('validates requests and provider output before serving the wire payload', async () => {
        const f = fixture();
        await expect(f.service.read({ provider: 'other' as 'claude' })).rejects.toThrow();
        f.read.mockResolvedValueOnce({ ...emptyUsage('claude', 'ok'), checkedAt: Infinity });
        expect((await f.service.read({ provider: 'claude' })).status).toBe('error');
    });
});
