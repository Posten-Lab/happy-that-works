import type { CodexProviderModel } from '@/sync/ops';

export function mergeCodexProviderModels(
    catalogs: readonly CodexProviderModel[][],
): CodexProviderModel[] {
    const merged = new Map<string, CodexProviderModel>();

    for (const catalog of catalogs) {
        for (const model of catalog) {
            const existing = merged.get(model.code);
            if (!existing) {
                merged.set(model.code, {
                    ...model,
                    supportedReasoningEfforts: model.supportedReasoningEfforts
                        ? [...model.supportedReasoningEfforts]
                        : undefined,
                });
                continue;
            }

            const efforts = new Map(
                (existing.supportedReasoningEfforts ?? []).map((effort) => [effort.code, effort]),
            );
            for (const effort of model.supportedReasoningEfforts ?? []) {
                if (!efforts.has(effort.code)) {
                    efforts.set(effort.code, effort);
                }
            }

            merged.set(model.code, {
                ...existing,
                description: existing.description ?? model.description,
                defaultReasoningEffort: existing.defaultReasoningEffort ?? model.defaultReasoningEffort,
                isDefault: Boolean(existing.isDefault || model.isDefault),
                supportedReasoningEfforts: efforts.size > 0 ? [...efforts.values()] : undefined,
            });
        }
    }

    return [...merged.values()];
}
