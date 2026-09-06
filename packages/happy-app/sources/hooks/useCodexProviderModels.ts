import * as React from 'react';
import { codexListModels, type CodexProviderModel } from '@/sync/ops';
import { useSocketStatus } from '@/sync/storage';
import { mergeCodexProviderModels } from '@/utils/codexProviderModels';

const DEFAULT_REFRESH_INTERVAL_MS = 60_000;
const EAGER_RETRY_DELAY_MS = 3_000;

/**
 * Keeps the Codex model catalog current for one machine-scoped picker or for
 * global settings spanning every online machine. A null result means live
 * discovery is unavailable and callers should use their compatibility fallback.
 */
export function useCodexProviderModels(
    machineIds: readonly string[],
    enabled = true,
    refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS,
): CodexProviderModel[] | null {
    const machineKey = [...new Set(machineIds)].sort().join('\u0000');
    const [models, setModels] = React.useState<CodexProviderModel[] | null>(null);
    const { status: socketStatus } = useSocketStatus();

    React.useEffect(() => {
        if (!enabled || machineKey.length === 0 || socketStatus !== 'connected') {
            setModels(null);
            return;
        }

        const ids = machineKey.split('\u0000');
        const catalogs = new Map<string, CodexProviderModel[]>();
        let cancelled = false;
        setModels(null);

        const refresh = () => {
            // Apply each machine independently. One stale/unreachable machine must
            // not prevent a responsive provider (for example the Mac advertising
            // a newly released model) from updating every picker.
            ids.forEach((machineId) => {
                void codexListModels(machineId).then((result) => {
                    if (cancelled || result.type !== 'success') return;
                    catalogs.set(machineId, result.models);
                    setModels(mergeCodexProviderModels([...catalogs.values()]));
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
    }, [enabled, machineKey, refreshIntervalMs, socketStatus]);

    return models;
}
