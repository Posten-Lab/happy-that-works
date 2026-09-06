import { createHash } from 'node:crypto';
import type { ProviderUsageBalance, ProviderUsageSnapshot, ProviderUsageWindow, UsageProvider } from '@ahmadposten/talos-wire';

export function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function numeric(value: unknown): number | null {
    if (typeof value !== 'number' && (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value))) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}
export function label(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    return value.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 120) || undefined;
}
export function identityHash(provider: UsageProvider, parts: unknown[]): string | undefined {
    const values = parts.filter((part): part is string => typeof part === 'string' && part.length > 0);
    return values.length ? createHash('sha256').update(JSON.stringify([provider, ...values])).digest('hex') : undefined;
}
function seconds(value: unknown): number | null {
    const number = numeric(value);
    return number !== null && number >= 0 && number * 1000 <= 8.64e15 ? number * 1000 : null;
}
function isoTime(value: unknown): number | null {
    if (typeof value === 'number') return seconds(value);
    if (typeof value !== 'string') return null;
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : null;
}
function remaining(percent: number | null): number | null {
    return percent === null ? null : Math.max(0, Math.min(100, 100 - percent));
}
function percentage(value: unknown): number | null {
    const number = numeric(value);
    return number === null || number < 0 ? null : number;
}
function title(key: string): string {
    return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}
export function emptyUsage(provider: UsageProvider, status: ProviderUsageSnapshot['status'], checkedAt = Date.now(), message?: string): ProviderUsageSnapshot {
    return { provider, status, account: null, checkedAt, dataAsOf: null, freshness: 'unknown', windows: [], balances: [], ...(message ? { message } : {}) };
}
function balance(id: string, text: string, kind: ProviderUsageBalance['kind'], unit: ProviderUsageBalance['unit']): ProviderUsageBalance {
    return { id, label: text, kind, unit, used: null, limit: null, remaining: null, usedPercent: null, resetsAt: null, expiresAt: null };
}
function windowLabel(duration: number | null, fallback: string): string {
    if (duration === 300) return '5-hour limit';
    if (duration === 10080) return 'Weekly limit';
    if (duration !== null && duration > 0) return duration % 1440 === 0 ? `${duration / 1440}-day limit` : duration % 60 === 0 ? `${duration / 60}-hour limit` : `${duration}-minute limit`;
    return title(fallback);
}

export function normalizeCodexUsage(accountResponse: unknown, limitsResponse: unknown, checkedAt = Date.now()): ProviderUsageSnapshot {
    const auth = record(accountResponse);
    const account = record(auth?.account);
    if (!auth || !('account' in auth)) return emptyUsage('codex', 'error', checkedAt, 'Codex returned an invalid account response.');
    if (!account) return emptyUsage('codex', 'unauthenticated', checkedAt, 'Sign in to Codex on this machine to see plan usage.');
    if (account.type !== 'chatgpt') return emptyUsage('codex', 'unsupported', checkedAt, 'Plan usage is available for Codex accounts signed in with ChatGPT.');
    const raw = record(limitsResponse);
    if (!raw || (!record(raw.rateLimits) && !record(raw.rateLimitsByLimitId))) return emptyUsage('codex', 'error', checkedAt, 'Codex returned an invalid usage response.');
    const result = emptyUsage('codex', 'ok', checkedAt);
    const legacy = record(raw.rateLimits);
    const plan = label(account.planType ?? legacy?.planType);
    result.account = { id: identityHash('codex', [typeof raw.accountId === 'string' && raw.accountId.trim() ? raw.accountId : undefined]), label: label(account.email) ?? (plan ? `ChatGPT ${title(plan)}` : 'ChatGPT'), ...(plan ? { plan } : {}) };
    result.freshness = 'live';
    result.dataAsOf = checkedAt;
    const buckets = new Map<string, Record<string, unknown>>();
    if (legacy) buckets.set(label(legacy.limitId) ?? 'codex', legacy);
    for (const [id, value] of Object.entries(record(raw.rateLimitsByLimitId) ?? {})) {
        const bucket = record(value);
        if (bucket) buckets.set(id, bucket);
    }
    for (const [id, bucket] of buckets) {
        const scope = label(bucket.limitName) ?? title(id);
        // Discover windows by shape so additional metered buckets/windows remain visible.
        for (const [key, value] of Object.entries(bucket)) {
            const rawWindow = record(value);
            if (!rawWindow || !('usedPercent' in rawWindow)) continue;
            const percent = percentage(rawWindow.usedPercent);
            const duration = numeric(rawWindow.windowDurationMins);
            result.windows.push({ id: `${id}:${key}`, label: windowLabel(duration, key), scope, usedPercent: percent, remainingPercent: remaining(percent), resetsAt: seconds(rawWindow.resetsAt), durationSeconds: duration === null ? null : duration * 60 });
        }
        const credits = record(bucket.credits);
        if (credits) result.balances.push({ ...balance(`${id}:credits`, `${scope} credits`, 'credits', 'credits'), remaining: numeric(credits.balance) ?? (credits.hasCredits === false ? 0 : null), unlimited: typeof credits.unlimited === 'boolean' ? credits.unlimited : undefined });
        const spend = record(bucket.individualLimit);
        if (spend) {
            const limit = numeric(spend.limit), used = numeric(spend.used), remainingPercent = numeric(spend.remainingPercent);
            result.balances.push({ ...balance(`${id}:spend`, `${scope} monthly credit limit`, 'spend_limit', 'credits'), limit, used, remaining: limit === null || used === null ? null : Math.max(0, limit - used), usedPercent: remainingPercent === null ? null : 100 - remainingPercent, resetsAt: seconds(spend.resetsAt) });
        }
        if (bucket.spendControlReached === true || bucket.rateLimitReachedType != null) {
            const notice = bucket.spendControlReached === true ? `${scope}: spending limit reached.` : `${scope}: usage limit reached.`;
            result.message = result.message ? `${result.message} ${notice}` : notice;
        }
    }
    const resets = record(raw.rateLimitResetCredits);
    if (resets) {
        result.balances.push({ ...balance('codex:resets', 'Usage resets available', 'resets', 'count'), remaining: numeric(resets.availableCount) });
        if (Array.isArray(resets.credits)) for (const [index, value] of resets.credits.entries()) {
            const credit = record(value);
            if (!credit || credit.status !== 'available') continue;
            result.balances.push({ ...balance(`codex:reset:${identityHash('codex', [credit.id]) ?? index}`, label(credit.title) ?? 'Usage reset', 'resets', 'count'), remaining: 1, expiresAt: seconds(credit.expiresAt) });
        }
    }
    if (!result.windows.length && !result.balances.length) { result.status = 'unavailable'; result.message = 'Codex did not report any usage limits for this account.'; }
    return result;
}

export function claudeAccountKey(accountInfo: unknown): string | undefined {
    const account = record(accountInfo);
    // Current SDK accountInfo exposes email and organization *name*, not immutable IDs.
    // Do not equate identically named workspaces or claim cross-machine identity.
    // Accept explicit IDs only if a future SDK adds them to this same-query response.
    return typeof account?.accountId === 'string' && account.accountId.trim() && typeof account.organizationId === 'string' && account.organizationId.trim()
        ? identityHash('claude', [account.accountId, account.organizationId]) : undefined;
}

function moneyExponent(value: unknown): number | null {
    const exponent = numeric(value);
    return exponent !== null && Number.isInteger(exponent) && exponent >= 0 && exponent <= 9 ? exponent : null;
}

/** The structured usage endpoint supplies the amount's exponent; never guess its units. */
function claudeMoney(value: unknown): { amount: number; currency: string } | null {
    const money = record(value);
    const currency = label(money?.currency)?.toUpperCase();
    const minor = numeric(money?.amount_minor), exponent = moneyExponent(money?.exponent);
    if (!currency || !/^[A-Z]{3}$/.test(currency) || minor === null || minor < 0 || exponent === null) return null;
    return { amount: minor / 10 ** exponent, currency };
}

function claudeDisabledReason(value: Record<string, unknown>, enabled: boolean | undefined): ProviderUsageBalance['disabledReason'] {
    if (enabled !== false) return undefined;
    const reason = value.disabled_reason;
    if (reason === 'out_of_credits' || reason === 'spend_limit_reached' || reason === 'user_disabled') return reason;
    if (value.spend_limit_reached === true) return 'spend_limit_reached';
    if (value.user_disabled === true) return 'user_disabled';
    return 'unavailable';
}

export function normalizeClaudeUsage(accountInfo: unknown, response: unknown, checkedAt = Date.now()): ProviderUsageSnapshot {
    const raw = record(response), auth = record(accountInfo) ?? {};
    if (!raw || typeof raw.rate_limits_available !== 'boolean' || !('rate_limits' in raw)) return emptyUsage('claude', 'error', checkedAt, 'Claude returned an unsupported usage response.');
    const plan = label(raw.subscription_type ?? auth.subscriptionType);
    const result = emptyUsage('claude', 'ok', checkedAt);
    const email = label(auth.email), organization = label(auth.organization);
    if (plan || email) result.account = { id: claudeAccountKey(auth), label: email ? (organization ? `${email} · ${organization}` : email) : (plan ? `Claude ${title(plan)}` : 'Claude'), ...(plan ? { plan } : {}) };
    if (!raw.rate_limits_available) {
        const signedIn = plan || auth.email || (auth.tokenSource && auth.tokenSource !== 'none') || (auth.apiKeySource && auth.apiKeySource !== 'none') || (auth.apiProvider && auth.apiProvider !== 'firstParty');
        result.status = signedIn ? 'unsupported' : 'unauthenticated';
        result.message = signedIn ? 'Subscription limits are unavailable for this Claude authentication method or account scope.' : 'Sign in to Claude on this machine to see plan usage.';
        return result;
    }
    const limits = record(raw.rate_limits);
    if (!limits) { result.status = 'unavailable'; result.message = 'Claude could not retrieve usage. Try again later.'; return result; }
    result.freshness = 'provider_cache_possible';
    const addWindow = (id: string, value: Record<string, unknown>, text?: string, scope?: string, duration?: number | null) => {
        const percent = percentage(value.utilization ?? value.percent);
        const durationSeconds = duration ?? (id === 'five_hour' ? 18000 : id.startsWith('seven_day') || id.startsWith('model:') ? 604800 : null);
        result.windows.push({ id, label: text ?? (id === 'five_hour' ? '5-hour limit' : id === 'seven_day' ? 'Weekly limit' : title(id)), ...(scope ? { scope } : {}), usedPercent: percent, remainingPercent: remaining(percent), resetsAt: isoTime(value.resets_at), durationSeconds });
    };
    const structured = Array.isArray(limits.limits) ? limits.limits.map(record).filter((item): item is Record<string, unknown> => !!item && ('percent' in item || 'utilization' in item)) : [];
    // New responses provide the complete display list. Older responses put only
    // additional model windows in limits[], with base quotas in legacy fields.
    const completeDisplayList = structured.some((item) => item.kind === 'session' || item.kind === 'weekly_all');
    const scopedNames = new Set<string>();
    if (!completeDisplayList) {
        for (const [key, value] of Object.entries(limits)) {
            if (key === 'extra_usage' || key === 'model_scoped' || key === 'limits' || key === 'spend') continue;
            const rawWindow = record(value);
            if (rawWindow && ('utilization' in rawWindow || 'resets_at' in rawWindow)) addWindow(key, rawWindow);
        }
        if (Array.isArray(limits.model_scoped)) for (const [index, value] of limits.model_scoped.entries()) {
            const model = record(value);
            if (!model) continue;
            const name = label(model.display_name) ?? `Model ${index + 1}`;
            scopedNames.add(name.toLowerCase());
            addWindow(`model:${name}:${index}`, model, 'Weekly limit', name);
        }
    }
    const structuredIds = new Set<string>();
    for (const [index, item] of structured.entries()) {
        const scope = record(item.scope), model = record(scope?.model), surface = record(scope?.surface);
        const scopedName = [label(model?.display_name), label(surface?.display_name)].filter(Boolean).join(' · ');
        const name = scopedName || label(item.display_name);
        const canonicalId = item.kind === 'session' ? 'five_hour' : item.kind === 'weekly_all' ? 'seven_day' : undefined;
        const id = canonicalId ? (name ? `${canonicalId}:${name}` : canonicalId) : `limit:${name ?? label(item.kind) ?? 'usage'}:${index}`;
        if (structuredIds.has(id) || (name && scopedNames.has(name.toLowerCase()))) continue;
        structuredIds.add(id);
        if (canonicalId) addWindow(id, item, canonicalId === 'five_hour' ? '5-hour limit' : 'Weekly limit', name, canonicalId === 'five_hour' ? 18000 : 604800);
        else addWindow(id, item, item.kind === 'weekly_scoped' ? 'Weekly limit' : name ?? title(label(item.kind) ?? 'Usage limit'), name, item.kind === 'weekly_scoped' ? 604800 : null);
    }
    const extra = record(limits.extra_usage);
    const spend = record(limits.spend);
    const spentMoney = claudeMoney(spend?.used), limitMoney = claudeMoney(spend?.limit ?? record(spend?.cap)?.money);
    const matchingCurrency = !spentMoney || !limitMoney || spentMoney.currency === limitMoney.currency;
    const hasStructuredSpend = spend !== null && matchingCurrency && (spentMoney !== null || limitMoney !== null);
    if (hasStructuredSpend) {
        const used = spentMoney?.amount ?? null, limit = limitMoney?.amount ?? null;
        const enabled = typeof spend.enabled === 'boolean' ? spend.enabled : undefined;
        result.balances.push({ ...balance('claude:extra_usage', 'Extra usage monthly spend', 'spend_limit', 'currency'), currency: (spentMoney ?? limitMoney)!.currency, used, limit, remaining: used === null || limit === null ? null : Math.max(0, limit - used), usedPercent: percentage(spend.percent), enabled, disabledReason: claudeDisabledReason({ ...extra, ...spend }, enabled), unlimited: enabled === true && limitMoney === null && extra?.is_enabled === true && extra.monthly_limit === null });
    } else if (extra) {
        const minorLimit = numeric(extra.monthly_limit), minorUsed = numeric(extra.used_credits);
        const currency = (label(extra.currency) ?? 'USD').toUpperCase();
        // Prefer the explicit provider exponent. Legacy responses omit it and
        // follow Claude's formatter (zero decimals for JPY/KRW/VND, two otherwise).
        const exponent = 'decimal_places' in extra ? moneyExponent(extra.decimal_places) : ['JPY', 'KRW', 'VND'].includes(currency) ? 0 : 2;
        const limit = minorLimit === null || exponent === null ? null : minorLimit / 10 ** exponent;
        const used = minorUsed === null || exponent === null ? null : minorUsed / 10 ** exponent;
        const enabled = typeof extra.is_enabled === 'boolean' ? extra.is_enabled : undefined;
        result.balances.push({ ...balance('claude:extra_usage', 'Extra usage monthly spend', 'spend_limit', 'currency'), currency, used, limit, remaining: limit === null || used === null ? null : Math.max(0, limit - used), usedPercent: percentage(extra.utilization), enabled, disabledReason: claudeDisabledReason(extra, enabled), unlimited: extra.is_enabled === true && extra.monthly_limit === null });
    }
    const creditMoney = claudeMoney(spend?.balance);
    if (creditMoney) result.balances.push({ ...balance('claude:usage_credits', 'Usage credits balance', 'credits', 'currency'), currency: creditMoney.currency, remaining: creditMoney.amount });
    if (!result.windows.length && !result.balances.length) { result.status = 'unavailable'; result.message = 'Claude did not report usage limits. Try again later.'; }
    if (result.windows.some((window) => window.resetsAt !== null && window.resetsAt <= checkedAt)) { result.freshness = 'stale'; result.message = [result.message, 'Some reported windows have passed their reset time. Claude may be returning cached usage.'].filter(Boolean).join(' '); }
    return result;
}
