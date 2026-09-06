import { useProviderModels } from './useProviderModels';

export function useClaudeProviderModels(machineIds: readonly string[], enabled = true, refreshIntervalMs?: number) {
    return useProviderModels('claude', machineIds, enabled, refreshIntervalMs);
}
