import * as React from 'react';
import { codexListModels, claudeListModels, museListModels, type ProviderModel } from '@/sync/ops';
import { useSocketStatus } from '@/sync/storage';
import { mergeProviderModels } from '@/utils/providerModels';

const DEFAULT_REFRESH_INTERVAL_MS = 60_000;
const EAGER_RETRY_DELAY_MS = 3_000;

/**
 * Keeps the provider model catalog current for one machine-scoped picker or for
 * global settings spanning every online machine. A null result means live
 * discovery is unavailable and callers should use their compatibility fallback.
 */
export function useProviderModels(
    provider: 'claude' | 'codex' | 'muse',
    machineIds: readonly string[],
    enabled = true,
    refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS,
): ProviderModel[] | null {
    const machineKey = [...new Set(machineIds)].sort().join('\u0000');
    const catalogKey = `${provider}:${machineKey}`;
    const [catalog, setCatalog] = React.useState<{ key: string; models: ProviderModel[] } | null>(null);
    const { status: socketStatus } = useSocketStatus();

    React.useEffect(() => {
        if (!enabled || machineKey.length === 0 || socketStatus !== 'connected') {
            setCatalog(null);
            return;
        }

        const ids = machineKey.split('\u0000');
        const catalogs = new Map<string, ProviderModel[]>();
        let cancelled = false;
        setCatalog(null);

        const refresh = () => {
            // Apply each machine independently. One stale/unreachable machine must
            // not prevent a responsive provider (for example the Mac advertising
            // a newly released model) from updating every picker.
            ids.forEach((machineId) => {
                void (provider === 'muse' ? museListModels : provider === 'claude' ? claudeListModels : codexListModels)(machineId).then((result) => {
                    if (cancelled || result.type !== 'success') return;
                    catalogs.set(machineId, result.models);
                    const models = mergeProviderModels([...catalogs.values()]);
                    // Unchanged polling responses must not reset picker selections.
                    setCatalog((previous) => previous?.key === catalogKey
                        && JSON.stringify(previous.models) === JSON.stringify(models)
                        ? previous
                        : { key: catalogKey, models });
                });
            });
        };

        refresh();
        // Native can emit "connected" just before persisted machine encryption
        // finishes restoring. Retry once after that short bootstrap window so a
        // transient first RPC failure does not leave the fallback visible for a
        // full refresh interval.
        const eagerRetry = setTimeout(refresh, Math.min(EAGER_RETRY_DELAY_MS, refreshIntervalMs));
        const interval = setInterval(refresh, refreshIntervalMs);
        return () => {
            cancelled = true;
            clearTimeout(eagerRetry);
            clearInterval(interval);
        };
    }, [provider, enabled, machineKey, catalogKey, refreshIntervalMs, socketStatus]);

    return enabled && socketStatus === 'connected' && catalog?.key === catalogKey ? catalog.models : null;
}
