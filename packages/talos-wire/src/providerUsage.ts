import * as z from 'zod';

export const UsageProviderSchema = z.enum(['codex', 'claude']);
export type UsageProvider = z.infer<typeof UsageProviderSchema>;

export const ProviderUsageRequestSchema = z.object({
    provider: UsageProviderSchema,
    refresh: z.boolean().optional(),
});
export type ProviderUsageRequest = z.infer<typeof ProviderUsageRequestSchema>;

/** Provider timestamps are normalized to epoch milliseconds. Null means unknown. */
export const ProviderUsageWindowSchema = z.object({
    id: z.string(),
    label: z.string(),
    scope: z.string().optional(),
    usedPercent: z.number().finite().nullable(),
    remainingPercent: z.number().finite().nullable(),
    resetsAt: z.number().finite().nullable(),
    durationSeconds: z.number().finite().nullable(),
});
export type ProviderUsageWindow = z.infer<typeof ProviderUsageWindowSchema>;

/** Currency amounts use major units; provider credits are a separate unit. */
export const ProviderUsageBalanceSchema = z.object({
    id: z.string(),
    label: z.string(),
    kind: z.enum(['credits', 'spend_limit', 'resets']),
    unit: z.enum(['credits', 'currency', 'count']),
    currency: z.string().optional(),
    used: z.number().finite().nullable(),
    limit: z.number().finite().nullable(),
    remaining: z.number().finite().nullable(),
    usedPercent: z.number().finite().nullable(),
    unlimited: z.boolean().optional(),
    enabled: z.boolean().optional(),
    resetsAt: z.number().finite().nullable(),
    expiresAt: z.number().finite().nullable(),
});
export type ProviderUsageBalance = z.infer<typeof ProviderUsageBalanceSchema>;

export const ProviderUsageSnapshotSchema = z.object({
    provider: UsageProviderSchema,
    status: z.enum(['ok', 'unauthenticated', 'unsupported', 'unavailable', 'error']),
    account: z.object({ id: z.string().optional(), label: z.string(), plan: z.string().optional() }).nullable(),
    checkedAt: z.number().finite(),
    /** A successful check can return provider-cached data with an unknown age. */
    dataAsOf: z.number().finite().nullable(),
    freshness: z.enum(['live', 'provider_cache_possible', 'cached', 'stale', 'unknown']),
    windows: z.array(ProviderUsageWindowSchema),
    balances: z.array(ProviderUsageBalanceSchema),
    message: z.string().optional(),
    retryAt: z.number().finite().optional(),
});
export type ProviderUsageSnapshot = z.infer<typeof ProviderUsageSnapshotSchema>;
