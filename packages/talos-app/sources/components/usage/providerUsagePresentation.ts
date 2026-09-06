import type { ProviderUsageWindow } from '@ahmadposten/talos-wire';

export type UsageSeverity = 'unknown' | 'normal' | 'caution' | 'critical' | 'exhausted';

/** Lead with the allowance that constrains work first, retaining provider order for ties. */
export function sortUsageWindows(windows: readonly ProviderUsageWindow[]): ProviderUsageWindow[] {
    const score = (window: ProviderUsageWindow) => usageSeverity(window.usedPercent) === 'unknown' ? -1 : window.usedPercent!;
    return [...windows].sort((a, b) => score(b) - score(a));
}

export function usageSeverity(usedPercent: number | null): UsageSeverity {
    if (usedPercent === null || !Number.isFinite(usedPercent) || usedPercent < 0) return 'unknown';
    if (usedPercent >= 100) return 'exhausted';
    if (usedPercent >= 95) return 'critical';
    if (usedPercent >= 80) return 'caution';
    return 'normal';
}

export const severityLabels: Record<UsageSeverity, string> = {
    unknown: 'Not reported',
    normal: 'Within limit',
    caution: 'Approaching limit',
    critical: 'Almost at limit',
    exhausted: 'Limit reached',
};

/** Avoid rounding a small available allowance down to zero, or up to a full allowance. */
export function formatRemainingPercent(value: number | null): string {
    if (value === null || !Number.isFinite(value) || value < 0 || value > 100) return '—';
    if (value > 0 && value < 0.1) return '<0.1';
    if (value > 99.9 && value < 100) return '>99.9';
    return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function validDate(timestamp: number | null): Date | null {
    if (timestamp === null || !Number.isFinite(timestamp)) return null;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function formatUsageDate(timestamp: number | null): string | null {
    const date = validDate(timestamp);
    if (!date) return null;
    return date.toLocaleString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    });
}

export function resetCountdown(timestamp: number | null, now: number): string {
    if (!validDate(timestamp)) return 'Reset time not reported';
    const remaining = timestamp! - now;
    if (remaining <= 0) return 'Reset time passed · refresh to check';
    if (remaining < 60_000) return 'Resets in less than a minute';
    const minutes = Math.ceil(remaining / 60_000);
    const days = Math.floor(minutes / 1_440);
    const hours = Math.floor((minutes % 1_440) / 60);
    const mins = minutes % 60;
    const duration = days > 0 ? `${days}d${hours ? ` ${hours}h` : ''}`
        : hours > 0 ? `${hours}h${mins ? ` ${mins}m` : ''}` : `${mins}m`;
    return `Resets in ${duration}`;
}

export function checkedAgo(timestamp: number | null, now: number): string {
    if (!validDate(timestamp)) return 'Not checked yet';
    const seconds = Math.max(0, (now - timestamp!) / 1_000);
    if (seconds < 60) return 'Checked just now';
    if (seconds < 3_600) return `Checked ${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86_400) return `Checked ${Math.floor(seconds / 3_600)}h ago`;
    return `Checked ${Math.floor(seconds / 86_400)}d ago`;
}

export function formatAllowance(value: number | null, unit: 'credits' | 'currency' | 'count', currency?: string): string {
    if (value === null || !Number.isFinite(value)) return '—';
    if (unit === 'credits' && value > 0 && value < 0.01) return '<0.01';
    if (unit === 'currency' && currency) {
        try {
            return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
        } catch { /* Preserve the reported amount if the provider's currency is unrecognized. */ }
    }
    return value.toLocaleString(undefined, { maximumFractionDigits: unit === 'count' ? 0 : 2 });
}
