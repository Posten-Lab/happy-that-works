import { describe, expect, it } from 'vitest';
import { ProviderUsageSnapshotSchema } from '@ahmadposten/talos-wire';
import { claudeAccountKey, normalizeClaudeUsage, normalizeCodexUsage } from './normalizeUsage';

const now = Date.parse('2026-09-06T12:00:00Z');
const reset = '2026-09-07T12:00:00Z';
const codexAccount = { account: { type: 'chatgpt', email: 'person@example.com', planType: 'pro' }, requiresOpenaiAuth: true };
const claudeAccount = { email: 'person@example.com', organization: 'org', subscriptionType: 'max' };
const claudeUsage = (limits: unknown) => ({ subscription_type: 'max', rate_limits_available: true, rate_limits: limits });

describe('provider usage normalization', () => {
    it('uses Codex window duration rather than primary/secondary position and includes future buckets', () => {
        const weekly = { usedPercent: 27, windowDurationMins: 10080, resetsAt: Date.parse(reset) / 1000 };
        const result = normalizeCodexUsage(codexAccount, { rateLimits: { limitId: 'codex', primary: weekly }, rateLimitsByLimitId: { codex: { primary: weekly }, future_model: { tertiary: { usedPercent: 0, windowDurationMins: 300, resetsAt: null } } }, accountId: 'account-uuid' }, now);
        expect(result.windows).toHaveLength(2);
        expect(result.windows[0]).toMatchObject({ label: 'Weekly limit', usedPercent: 27, remainingPercent: 73, durationSeconds: 604800, resetsAt: Date.parse(reset) });
        expect(result.windows[1]).toMatchObject({ label: '5-hour limit', usedPercent: 0, remainingPercent: 100 });
        expect(result.account?.id).toMatch(/^[a-f0-9]{64}$/);
        expect(result.account?.label).toBe('person@example.com');
        expect(JSON.stringify(result)).not.toContain('account-uuid');
        expect(ProviderUsageSnapshotSchema.safeParse(result).success).toBe(true);
    });

    it('preserves credit decimals, unlimited state, credit spend controls and reset expiry', () => {
        const result = normalizeCodexUsage(codexAccount, {
            rateLimits: { credits: { hasCredits: true, unlimited: false, balance: '0.0000250000' }, individualLimit: { limit: '200', used: '75.5', remainingPercent: 62, resetsAt: Date.parse(reset) / 1000 } },
            rateLimitResetCredits: { availableCount: 5, credits: [{ id: 'private-reset', status: 'available', expiresAt: Date.parse(reset) / 1000, title: 'Full reset' }, { status: 'redeemed' }] },
        }, now);
        expect(result.balances[0]).toMatchObject({ remaining: 0.000025, unit: 'credits', unlimited: false });
        expect(result.balances[1]).toMatchObject({ limit: 200, used: 75.5, remaining: 124.5, usedPercent: 38, unit: 'credits' });
        expect(result.balances[2]).toMatchObject({ remaining: 5, unit: 'count' });
        expect(result.balances[3]).toMatchObject({ remaining: 1, expiresAt: Date.parse(reset), resetsAt: null });
        expect(result.balances).toHaveLength(4);
        expect(JSON.stringify(result)).not.toContain('private-reset');
        const unlimited = normalizeCodexUsage(codexAccount, { rateLimits: { credits: { hasCredits: true, unlimited: true, balance: null } } }, now);
        expect(unlimited.balances[0]).toMatchObject({ unlimited: true, remaining: null });
    });

    it('does not turn absent Codex values into zero or fabricate token totals', () => {
        const result = normalizeCodexUsage(codexAccount, { rateLimits: { primary: { usedPercent: null, resetsAt: null }, credits: { balance: null } } }, now);
        expect(result.windows[0]).toMatchObject({ usedPercent: null, remainingPercent: null, resetsAt: null, durationSeconds: null });
        expect(result.balances[0].remaining).toBeNull();
        expect(result.account?.id).toBeUndefined();
        expect(normalizeCodexUsage({ account: null }, {}, now).status).toBe('unauthenticated');
        expect(normalizeCodexUsage({ account: { type: 'apiKey' } }, {}, now).status).toBe('unsupported');
        expect(normalizeCodexUsage(codexAccount, { error: 'failure' }, now).status).toBe('error');
    });

    it('does not treat Claude email and organization display names as an immutable identity', () => {
        expect(claudeAccountKey(claudeAccount)).toBeUndefined();
        const result = normalizeClaudeUsage(claudeAccount, claudeUsage({ five_hour: { utilization: 5, resets_at: reset } }), now);
        expect(result.account?.id).toBeUndefined();
        expect(result.account?.label).toBe('person@example.com · org');
        expect(claudeAccountKey({ accountId: 'account-uuid', organizationId: 'org-uuid' })).toMatch(/^[a-f0-9]{64}$/);
    });

    it('shows unfunded credits and reported exhaustion without calling them disabled', () => {
        const result = normalizeCodexUsage(codexAccount, { rateLimits: { credits: { hasCredits: false, balance: null }, primary: { usedPercent: -5 }, spendControlReached: true } }, now);
        expect(result.balances[0]).toMatchObject({ remaining: 0 });
        expect(result.balances[0].enabled).toBeUndefined();
        expect(result.windows[0]).toMatchObject({ usedPercent: null, remainingPercent: null });
        expect(result.message).toContain('spending limit reached');
    });

    it('treats Claude snapshot utilization as 0–100, discovers new windows and deduplicates model projections', () => {
        const result = normalizeClaudeUsage(claudeAccount, claudeUsage({
            five_hour: { utilization: 0.75, resets_at: reset },
            seven_day: { utilization: 41.2, resets_at: reset },
            seven_day_opus: { utilization: 99, resets_at: reset },
            future_pool: { utilization: 5, resets_at: null },
            seven_day_sonnet: null,
            model_scoped: [{ display_name: 'Fable', utilization: 17, resets_at: reset }],
            limits: [{ kind: 'weekly_scoped', scope: { model: { display_name: 'Fable' } }, percent: 17, resets_at: reset }, { kind: 'daily_scoped', scope: { model: { display_name: 'Future' } }, percent: 3, resets_at: reset }],
        }), now);
        expect(result.windows).toHaveLength(6);
        expect(result.windows[0]).toMatchObject({ usedPercent: 0.75, remainingPercent: 99.25, resetsAt: Date.parse(reset) });
        expect(result.windows.filter((window) => window.scope === 'Fable')).toHaveLength(1);
        expect(result.freshness).toBe('provider_cache_possible');
        expect(result.dataAsOf).toBeNull();
        expect(ProviderUsageSnapshotSchema.safeParse(result).success).toBe(true);
    });

    it.each([['USD', 100], ['EUR', 100], ['JPY', 1], ['KRW', 1], ['VND', 1]])('normalizes %s spending units', (currency, divisor) => {
        const result = normalizeClaudeUsage(claudeAccount, claudeUsage({ extra_usage: { is_enabled: true, monthly_limit: 2500, used_credits: 500, utilization: 20, currency } }), now);
        expect(result.balances[0]).toMatchObject({ unit: 'currency', currency, limit: 2500 / Number(divisor), used: 500 / Number(divisor), remaining: 2000 / Number(divisor), usedPercent: 20, enabled: true, unlimited: false });
    });

    it('handles disabled/unlimited extra usage and defaults provider currency to USD', () => {
        const enabled = normalizeClaudeUsage(claudeAccount, claudeUsage({ extra_usage: { is_enabled: true, monthly_limit: null, used_credits: null } }), now);
        expect(enabled.balances[0]).toMatchObject({ unlimited: true, currency: 'USD', limit: null, used: null, remaining: null });
        const disabled = normalizeClaudeUsage(claudeAccount, claudeUsage({ extra_usage: { is_enabled: false, monthly_limit: null, used_credits: 0 } }), now);
        expect(disabled.balances[0]).toMatchObject({ enabled: false, unlimited: false, used: 0 });
    });

    it('keeps stale provider usage honest after the reset rather than resetting the percentage locally', () => {
        const result = normalizeClaudeUsage(claudeAccount, claudeUsage({ five_hour: { utilization: 110, resets_at: '2026-09-05T12:00:00Z' } }), now);
        expect(result.freshness).toBe('stale');
        expect(result.windows[0]).toMatchObject({ usedPercent: 110, remainingPercent: 0 });
    });

    it('distinguishes unauthenticated, unsupported authentication, failed fetch and malformed responses', () => {
        const unavailable = { rate_limits_available: false, rate_limits: null, subscription_type: null };
        expect(normalizeClaudeUsage({ apiProvider: 'firstParty', tokenSource: 'none' }, unavailable, now).status).toBe('unauthenticated');
        expect(normalizeClaudeUsage({ apiProvider: 'bedrock' }, unavailable, now).status).toBe('unsupported');
        expect(normalizeClaudeUsage({ apiKeySource: 'user' }, unavailable, now).status).toBe('unsupported');
        expect(normalizeClaudeUsage(claudeAccount, claudeUsage(null), now).status).toBe('unavailable');
        expect(normalizeClaudeUsage(claudeAccount, {}, now).status).toBe('error');
    });
});
