import { describe, expect, it } from 'vitest';
import { balanceRemainingSuffix, checkedAgo, disabledUsageState, formatAllowance, formatRemainingPercent, formatUsageDate, resetCountdown, sortUsageWindows, usageSeverity } from './providerUsagePresentation';

describe('subscription usage presentation', () => {
    it('surfaces the most constrained limit without mutating provider data or elevating unknown values', () => {
        const windows = [null, 20, 95, 0, 95].map((usedPercent, index) => ({ id: String(index), label: 'Window', usedPercent, remainingPercent: null, durationSeconds: null, resetsAt: null }));
        expect(sortUsageWindows(windows).map(window => window.id)).toEqual(['2', '4', '1', '3', '0']);
        expect(windows.map(window => window.id)).toEqual(['0', '1', '2', '3', '4']);
    });
    it('changes severity exactly at the allowance boundaries', () => {
        expect([null, NaN, -1, 0, 79.99, 80, 94.99, 95, 99.99, 100, 120].map(usageSeverity))
            .toEqual(['unknown', 'unknown', 'unknown', 'normal', 'normal', 'caution', 'caution', 'critical', 'critical', 'exhausted', 'exhausted']);
    });

    it('keeps unknown and fractional allowance distinct from empty and full', () => {
        expect(formatRemainingPercent(null)).toBe('—');
        expect(formatRemainingPercent(NaN)).toBe('—');
        expect(formatRemainingPercent(101)).toBe('—');
        expect(formatRemainingPercent(0)).toBe('0');
        expect(formatRemainingPercent(0.01)).toBe('<0.1');
        expect(formatRemainingPercent(99.99)).toBe('>99.9');
        expect(formatRemainingPercent(100)).toBe('100');
    });

    it('never invents a new limit window when a cached reset time passes', () => {
        const now = Date.UTC(2026, 8, 6, 12);
        expect(resetCountdown(null, now)).toBe('Reset time not reported');
        expect(resetCountdown(NaN, now)).toBe('Reset time not reported');
        expect(resetCountdown(now, now)).toBe('Reset time passed · refresh to check');
        expect(resetCountdown(now - 1_000, now)).toBe('Reset time passed · refresh to check');
        expect(resetCountdown(now + 1_000, now)).toBe('Resets in less than a minute');
        expect(resetCountdown(now + 60_000, now)).toBe('Resets in 1m');
        expect(resetCountdown(now + 3_660_000, now)).toBe('Resets in 1h 1m');
        expect(resetCountdown(now + 176_400_000, now)).toBe('Resets in 2d 1h');
    });

    it('rejects dates outside the Date range and labels clock skew safely', () => {
        expect(formatUsageDate(1e20)).toBeNull();
        expect(formatUsageDate(null)).toBeNull();
        expect(checkedAgo(null, 100_000)).toBe('Not checked yet');
        expect(checkedAgo(100_100, 100_000)).toBe('Checked just now');
        expect(formatUsageDate(Date.UTC(2026, 8, 6))).toContain('2026');
    });

    it('does not turn missing balances into zero or add a currency assumption', () => {
        expect(formatAllowance(null, 'currency', 'USD')).toBe('—');
        expect(formatAllowance(0, 'credits')).toBe('0');
        expect(formatAllowance(0.00001, 'credits')).toBe('<0.01');
        expect(formatAllowance(0.009, 'credits')).toBe('<0.01');
        expect(formatAllowance(0.01, 'credits')).toBe('0.01');
        expect(formatAllowance(128.883025, 'credits')).toBe('128.88');
        expect(formatAllowance(12.3, 'currency', 'USD')).toContain('12.30');
        expect(formatAllowance(12.3, 'currency')).toBe('12.3');
    });

    it('distinguishes exhausted credits and spend caps from a user turning extra usage off', () => {
        const balance = { kind: 'spend_limit' as const, enabled: false };
        expect(disabledUsageState({ ...balance, disabledReason: 'out_of_credits' })?.label).toBe('No credits');
        expect(disabledUsageState({ ...balance, disabledReason: 'spend_limit_reached' })?.label).toBe('Limit reached');
        expect(disabledUsageState({ ...balance, disabledReason: 'user_disabled' })?.label).toBe('Off');
        expect(disabledUsageState({ ...balance, disabledReason: 'unavailable' })?.label).toBe('Unavailable');
        expect(disabledUsageState(balance)?.label).toBe('Unavailable');
        expect(disabledUsageState({ ...balance, enabled: true })).toBeNull();
        expect(disabledUsageState({ kind: 'credits', enabled: false })).toBeNull();
    });

    it('keeps monetary credit balances distinct from provider credit units and spending capacity', () => {
        expect(formatAllowance(100, 'currency', 'GBP')).toBe('£100.00');
        expect(formatAllowance(0, 'currency', 'GBP')).toBe('£0.00');
        expect(formatAllowance(12.3, 'currency', 'GBP')).toContain('12.30');
        expect(formatAllowance(0.123, 'currency', 'BHD')).toContain('0.123');
        expect(formatAllowance(0.001, 'currency', 'GBP')).toBe('<£0.01');
        expect(formatAllowance(0.0001, 'currency', 'BHD')).toMatch(/^<.*0\.001/);
        expect(formatAllowance(0.1, 'currency', 'JPY')).toMatch(/^<.*1$/);
        const credits = { kind: 'credits' as const, remaining: 12.3 };
        expect(balanceRemainingSuffix({ ...credits, unit: 'currency' })).toBe(' remaining');
        expect(balanceRemainingSuffix({ ...credits, unit: 'credits' })).toBe(' credits remaining');
        expect(balanceRemainingSuffix({ kind: 'spend_limit', unit: 'currency', remaining: 100 })).toBe(' left to spend');
        expect(balanceRemainingSuffix({ kind: 'spend_limit', unit: 'credits', remaining: 100 })).toBe(' credits left to spend');
        expect(balanceRemainingSuffix({ ...credits, unit: 'currency', remaining: null })).toBe('');
    });
});
