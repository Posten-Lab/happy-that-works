import { useProviderModels } from './useProviderModels';

export function useCodexProviderModels(machineIds: readonly string[], enabled = true, refreshIntervalMs?: number) {
    return useProviderModels('codex', machineIds, enabled, refreshIntervalMs);
}
