import { ProviderUsageRequestSchema, ProviderUsageSnapshotSchema, type ProviderUsageRequest, type ProviderUsageSnapshot, type UsageProvider } from '@ahmadposten/talos-wire';
import { emptyUsage } from './normalizeUsage';
import { readClaudeUsage, readCodexUsage, usageFailure, type UsageAdapter } from './providerUsageAdapters';

const CACHE_MS = 5 * 60_000;
const MIN_REFRESH_MS = 30_000;

/** One instance per daemon: share checks across phones/sessions, and partition by verified account. */
export class ProviderUsageService {
    private cache = new Map<UsageProvider, { accountKey: string; snapshot: ProviderUsageSnapshot; readAt: number }>();
    private inflight = new Map<UsageProvider, Promise<ProviderUsageSnapshot>>();
    private lastAttempt = new Map<UsageProvider, number>();

    constructor(private readonly adapters: Record<UsageProvider, UsageAdapter> = { codex: readCodexUsage, claude: readClaudeUsage }, private readonly now = Date.now) {}

    async read(input: ProviderUsageRequest): Promise<ProviderUsageSnapshot> {
        const params = ProviderUsageRequestSchema.parse(input);
        const pending = this.inflight.get(params.provider);
        if (pending) return pending;
        const task = this.collect(params).catch((error) => usageFailure(params.provider, error, this.now()));
        this.inflight.set(params.provider, task);
        try { return await task; }
        finally { if (this.inflight.get(params.provider) === task) this.inflight.delete(params.provider); }
    }

    private async collect({ provider, refresh }: ProviderUsageRequest): Promise<ProviderUsageSnapshot> {
        return this.adapters[provider](async (accountKey, read) => {
            const now = this.now();
            const previous = this.cache.get(provider);
            // Never reuse a previous account's snapshot, or an unidentified account's data.
            const cached = accountKey && previous?.accountKey === accountKey ? previous : undefined;
            if (!cached) this.cache.delete(provider);
            const retryAt = (this.lastAttempt.get(provider) ?? -Infinity) + MIN_REFRESH_MS;
            if (cached && ((!refresh && now - cached.readAt < CACHE_MS) || now < retryAt)) return { ...cached.snapshot, freshness: cached.snapshot.freshness === 'stale' ? 'stale' : 'cached', retryAt: Math.max(now, retryAt) };
            if (now < retryAt) return { ...emptyUsage(provider, 'unavailable', now, 'Please wait a moment before checking usage again.'), retryAt };
            this.lastAttempt.set(provider, now);
            try {
                const snapshot = ProviderUsageSnapshotSchema.parse(await read());
                if (snapshot.provider !== provider) throw new Error('Invalid provider usage response');
                if (accountKey && snapshot.status === 'ok') this.cache.set(provider, { accountKey, snapshot, readAt: now });
                return { ...snapshot, retryAt: now + MIN_REFRESH_MS };
            } catch (error) {
                if (cached) return { ...cached.snapshot, freshness: 'stale', message: 'Usage could not be refreshed. Showing the previous check for this account.', retryAt: now + MIN_REFRESH_MS };
                throw error;
            }
        });
    }
}
