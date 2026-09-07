import { ProviderUsageSnapshotSchema, type ProviderUsageSnapshot } from '@ahmadposten/talos-wire';
import { apiSocket } from './apiSocket';

export type UsageProvider = 'codex' | 'claude';

export type ProviderUsageEntry = {
    key: string;
    provider: UsageProvider;
    machineId: string;
    machineIds: string[];
    machineLabel: string;
    online: boolean;
    refreshing: boolean;
    snapshot: ProviderUsageSnapshot | null;
    error?: string;
    sources?: Array<{ machineId: string; label: string; online: boolean; refreshing: boolean; message?: string }>;
};

export const USAGE_CLI_UPDATE_MESSAGE = 'Update Talos on this machine to version 1.0.2 or later, then restart its daemon to view account limits.';

/** Capabilities survive renamed products whose version numbers are not comparable. */
export function requiresUsageCliUpdate(metadata: { providerUsage?: { rpcAvailable: boolean } } | null | undefined): boolean {
    return !!metadata && metadata.providerUsage?.rpcAvailable !== true;
}

/** Read account quotas over the same encrypted channel as provider discovery. */
export async function readProviderUsage(
    machineId: string,
    provider: UsageProvider,
    refresh = false,
): Promise<ProviderUsageSnapshot> {
    let response: unknown;
    try {
        response = await apiSocket.machineRPC<unknown, { provider: UsageProvider; refresh: boolean }>(
            machineId, 'provider-usage', { provider, refresh }, 30_000,
        );
    } catch (error) {
        // Older daemons cannot serve this method. Avoid displaying RPC envelopes
        // or implementation errors in the account dashboard.
        if (error instanceof Error && /not (registered|found)|unknown method|method.*(?:unavailable|not available)/i.test(error.message)) {
            throw new Error(USAGE_CLI_UPDATE_MESSAGE);
        }
        throw new Error('Could not reach this machine. Check its connection and try again.');
    }
    const parsed = ProviderUsageSnapshotSchema.safeParse(response);
    if (!parsed.success || parsed.data.provider !== provider) {
        throw new Error('This machine could not provide usage data. Update its Talos CLI and try again.');
    }
    return parsed.data;
}

/** Identical account quotas from multiple machines are one snapshot, never a sum. */
export function mergeProviderUsageEntries(entries: readonly ProviderUsageEntry[]): ProviderUsageEntry[] {
    const isHealthy = (entry: ProviderUsageEntry) => entry.online && entry.snapshot?.status === 'ok'
        && entry.snapshot.freshness !== 'stale' && !entry.error;
    const groups = new Map<string, ProviderUsageEntry[]>();
    for (const entry of entries) {
        const accountId = entry.snapshot?.account?.id;
        const hasReading = !!entry.snapshot && (entry.snapshot.windows.length > 0 || entry.snapshot.balances.length > 0);
        // Group only unresolved lookups, never infer that unidentified quota readings share an account.
        const key = accountId ? `${entry.provider}:account:${accountId}`
            : !hasReading && !entry.snapshot?.account ? `${entry.provider}:unresolved` : entry.key;
        const group = groups.get(key) ?? [];
        group.push(entry);
        groups.set(key, group);
    }
    return [...groups.entries()].map(([key, group]) => {
        const latest = [...group].sort((a, b) => {
            // A failed refresh on one machine must not replace another machine's
            // successful account read. Within that class use the latest check.
            const aGood = isHealthy(a) ? 1 : 0;
            const bGood = isHealthy(b) ? 1 : 0;
            return bGood - aGood || (b.snapshot?.checkedAt ?? 0) - (a.snapshot?.checkedAt ?? 0);
        })[0];
        return {
            ...latest,
            key,
            snapshot: latest.snapshot && (latest.snapshot.windows.length > 0 || latest.snapshot.balances.length > 0) && !isHealthy(latest)
                ? { ...latest.snapshot, freshness: 'stale' as const } : latest.snapshot,
            error: isHealthy(latest) ? undefined : latest.error ?? group.find(entry => entry.error)?.error,
            sources: group.flatMap(e => e.sources ?? [{ machineId: e.machineId, label: e.machineLabel,
                online: e.online, refreshing: e.refreshing, message: e.error ?? e.snapshot?.message }]),
            machineIds: [...new Set(group.flatMap(e => e.machineIds))],
            machineLabel: [...new Set(group.map(e => e.machineLabel))].join(' · '),
            online: group.some(e => e.online),
            refreshing: group.some(e => e.refreshing),
        };
    }).sort((a, b) => (a.provider === b.provider ? 0 : a.provider === 'codex' ? -1 : 1)
        || a.machineLabel.localeCompare(b.machineLabel));
}

/** A machine lookup is a source, not evidence of another subscription. */
export function partitionProviderUsageEntries(entries: readonly ProviderUsageEntry[]) {
    return {
        accounts: entries.filter(entry => !!entry.snapshot?.account?.id),
        connections: entries.filter(entry => !entry.snapshot?.account?.id),
    };
}
