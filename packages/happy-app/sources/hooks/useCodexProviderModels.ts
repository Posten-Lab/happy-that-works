import * as React from 'react';
import { codexListModels, type CodexProviderModel } from '@/sync/ops';
import { mergeCodexProviderModels } from '@/utils/codexProviderModels';

const DEFAULT_REFRESH_INTERVAL_MS = 60_000;

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

    React.useEffect(() => {
        if (!enabled || machineKey.length === 0) {
            setModels(null);
            return;
        }

        const ids = machineKey.split('\u0000');
        let cancelled = false;
        setModels(null);

        const refresh = async () => {
            const results = await Promise.all(ids.map((machineId) => codexListModels(machineId)));
            if (cancelled) return;

            const successfulCatalogs = results
                .filter((result) => result.type === 'success')
                .map((result) => result.models);
            if (successfulCatalogs.length > 0) {
                setModels(mergeCodexProviderModels(successfulCatalogs));
            }
        };

        void refresh();
        const interval = setInterval(() => { void refresh(); }, refreshIntervalMs);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [enabled, machineKey, refreshIntervalMs]);

    return models;
}
