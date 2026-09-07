import { partitionProviderUsageEntries } from '@/sync/providerUsage';
import * as React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { ProviderUsageBalance, ProviderUsageWindow } from '@ahmadposten/talos-wire';
import { Text } from '@/components/StyledText';
import type { ProviderUsageEntry } from '@/sync/providerUsage';
import {
    balanceRemainingSuffix, checkedAgo, disabledUsageState, formatAllowance, formatRemainingPercent, formatUsageDate,
    resetCountdown, severityLabels, sortUsageWindows, usageSeverity, type UsageSeverity,
} from './providerUsagePresentation';

export interface AccountUsageDashboardProps {
    entries: ProviderUsageEntry[];
    loading: boolean;
    refreshing: boolean;
    refresh: () => void;
    machineCount: number;
}

const styles = StyleSheet.create((theme) => ({
    dashboard: { width: '100%', maxWidth: 1080, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 32, paddingBottom: 28, gap: 28 },
    heading: { gap: 12 },
    eyebrow: { color: theme.colors.accent, fontSize: 11, fontWeight: '700', letterSpacing: 2.1 },
    title: { color: theme.colors.text, fontSize: 34, lineHeight: 41, fontWeight: '600', letterSpacing: -1.2 },
    subtitle: { color: theme.colors.textSecondary, fontSize: 15, lineHeight: 23, maxWidth: 550 },
    toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    scopeNote: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
    small: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 },
    refresh: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 42, paddingHorizontal: 15, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface },
    refreshLabel: { color: theme.colors.text, fontSize: 13, fontWeight: '600' },
    grid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 18 },
    card: { width: '100%', minWidth: 0, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 22, backgroundColor: theme.colors.surface, overflow: 'hidden' },
    cardHeader: { padding: 22, gap: 18, borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
    providerRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
    providerIcon: { height: 42, width: 42, borderRadius: 13, backgroundColor: theme.colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
    provider: { color: theme.colors.text, fontSize: 21, lineHeight: 27, fontWeight: '600', letterSpacing: -0.5 },
    providerDescription: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 },
    account: { color: theme.colors.text, fontSize: 13, lineHeight: 19, fontWeight: '500', flexShrink: 1 },
    identity: { gap: 5 },
    identityRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    badge: { borderRadius: 20, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: theme.colors.surfaceHigh, maxWidth: '40%' },
    badgeText: { color: theme.colors.textSecondary, fontSize: 11, lineHeight: 16, fontWeight: '500' },
    window: { padding: 22, gap: 14 },
    compactWindow: { paddingHorizontal: 22, paddingVertical: 18, gap: 11 },
    compactWindowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 18 },
    compactAmount: { alignItems: 'flex-end', gap: 1 },
    compactNumber: { color: theme.colors.text, fontSize: 27, lineHeight: 31, fontWeight: '500', letterSpacing: -0.9, fontVariant: ['tabular-nums'] },
    compactPercent: { color: theme.colors.textSecondary, fontSize: 16, fontWeight: '400', letterSpacing: -0.3 },
    compactRemaining: { color: theme.colors.textSecondary, fontSize: 11, lineHeight: 15 },
    divider: { borderTopWidth: 1, borderTopColor: theme.colors.divider },
    windowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 },
    windowLabel: { color: theme.colors.text, fontSize: 14, lineHeight: 20, fontWeight: '500' },
    windowScope: { color: theme.colors.textSecondary, fontSize: 11, lineHeight: 17, marginTop: 2 },
    percentLine: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 7 },
    number: { color: theme.colors.text, fontSize: 46, lineHeight: 53, fontWeight: '500', letterSpacing: -2, fontVariant: ['tabular-nums'] },
    heroNumber: { fontSize: 60, lineHeight: 67, letterSpacing: -2.5 },
    percentSymbol: { color: theme.colors.textSecondary, fontSize: 25, fontWeight: '400', letterSpacing: -0.8 },
    remaining: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19 },
    track: { height: 8, borderRadius: 5, backgroundColor: theme.colors.surfaceHigh, overflow: 'hidden' },
    fill: { height: '100%', borderRadius: 5 },
    reset: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
    resetPrimary: { color: theme.colors.text, fontSize: 12, lineHeight: 18 },
    resetSecondary: { color: theme.colors.textSecondary, fontSize: 11, lineHeight: 17, marginTop: 1 },
    balances: { marginHorizontal: 16, marginBottom: 16, borderRadius: 15, backgroundColor: theme.colors.groupped.background, paddingHorizontal: 16 },
    balance: { paddingVertical: 17, gap: 7 },
    balanceTop: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    balanceTitle: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18, fontWeight: '500', flexShrink: 1 },
    balanceValue: { color: theme.colors.text, fontSize: 29, lineHeight: 35, letterSpacing: -0.8, fontWeight: '500', fontVariant: ['tabular-nums'] },
    balanceSuffix: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18, letterSpacing: 0 },
    resetDetail: { paddingVertical: 13, gap: 5 },
    resetDetailTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 14 },
    resetDetailValue: { color: theme.colors.text, fontSize: 13, lineHeight: 19, fontWeight: '500', fontVariant: ['tabular-nums'] },
    cardFooter: { paddingHorizontal: 22, paddingVertical: 14, backgroundColor: theme.colors.groupped.background, gap: 5 },
    footerRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between', gap: 6 },
    footerText: { color: theme.colors.textSecondary, fontSize: 11, lineHeight: 17 },
    notice: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 19 },
    empty: { alignItems: 'center', paddingHorizontal: 24, paddingVertical: 38, gap: 12 },
    emptyIcon: { height: 62, width: 62, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: theme.colors.accentSoft, marginBottom: 6 },
    emptyTitle: { color: theme.colors.text, textAlign: 'center', fontSize: 18, lineHeight: 25, fontWeight: '500' },
    emptyDescription: { color: theme.colors.textSecondary, textAlign: 'center', fontSize: 13, lineHeight: 21, maxWidth: 360 },
    footnote: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingHorizontal: 2 },
    attention: { padding: 18, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.accent, backgroundColor: theme.colors.accentSoft, gap: 14 },
    attentionHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    attentionTitle: { color: theme.colors.text, fontSize: 13, fontWeight: '600' },
    attentionItem: { gap: 3 },
    attentionName: { color: theme.colors.text, fontSize: 13, lineHeight: 19, fontWeight: '500' },
}));

function useUsageColors() {
    const { theme } = useUnistyles();
    return {
        unknown: theme.colors.textSecondary,
        normal: theme.dark ? '#A4C9A2' : '#386D49',
        caution: theme.dark ? '#E2BD78' : '#855617',
        critical: theme.dark ? '#EFAB95' : '#A14129',
        exhausted: theme.dark ? '#F49B95' : '#A83530',
    } satisfies Record<UsageSeverity, string>;
}

function UsageMeter({ remaining, color, label, compact = false }: { remaining: number | null; color: string; label: string; compact?: boolean }) {
    const known = remaining !== null && Number.isFinite(remaining) && remaining >= 0 && remaining <= 100;
    return (
        <View
            style={[styles.track, compact && { height: 5 }]}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={label}
            accessibilityValue={known ? { min: 0, max: 100, now: remaining, text: `${formatRemainingPercent(remaining)}% remaining` } : { text: 'Allowance not reported' }}
        >
            {known && <View style={[styles.fill, { width: `${remaining}%`, backgroundColor: color }]} />}
        </View>
    );
}

function LimitWindow({ window, primary, now }: { window: ProviderUsageWindow; primary: boolean; now: number }) {
    const { theme } = useUnistyles();
    const colors = useUsageColors();
    const severity = usageSeverity(window.usedPercent);
    const percent = formatRemainingPercent(window.remainingPercent);
    const resetDate = formatUsageDate(window.resetsAt);
    if (!primary) {
        return (
            <View style={[styles.compactWindow, styles.divider]}>
                <View style={styles.compactWindowTop}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.windowLabel}>{window.label}</Text>
                        {!!window.scope && <Text style={styles.windowScope}>{window.scope}</Text>}
                        {severity !== 'normal' && <Text style={[styles.badgeText, { color: colors[severity], marginTop: 3 }]}>{severityLabels[severity]}</Text>}
                    </View>
                    <View style={styles.compactAmount}>
                        <Text style={styles.compactNumber} accessibilityLabel={percent === '—' ? 'Remaining allowance not reported' : `${percent} percent remaining`}>
                            {percent}{percent !== '—' && <Text style={styles.compactPercent}>%</Text>}
                        </Text>
                        <Text style={styles.compactRemaining}>{percent === '—' ? 'not reported' : 'remaining'}</Text>
                    </View>
                </View>
                <UsageMeter compact remaining={window.remainingPercent} color={colors[severity]} label={`${window.scope ? `${window.scope}, ` : ''}${window.label}`} />
                <View style={styles.reset}>
                    <Ionicons name="time-outline" size={13} color={theme.colors.textSecondary} style={{ marginTop: 2 }} />
                    <View style={{ flex: 1 }}>
                        <Text style={styles.resetPrimary}>{resetCountdown(window.resetsAt, now)}</Text>
                        {resetDate && <Text style={styles.resetSecondary}>{resetDate}</Text>}
                    </View>
                </View>
            </View>
        );
    }
    return (
        <View style={[styles.window, !primary && styles.divider]}>
            <View style={styles.windowTop}>
                <View style={{ flexShrink: 1 }}>
                    <Text style={styles.windowLabel}>{window.label}</Text>
                    {!!window.scope && <Text style={styles.windowScope}>{window.scope}</Text>}
                </View>
                <Text style={[styles.badgeText, { color: colors[severity] }]}>{severityLabels[severity]}</Text>
            </View>
            <View style={styles.percentLine}>
                <Text style={[styles.number, primary && styles.heroNumber]} accessibilityLabel={percent === '—' ? 'Remaining allowance not reported' : `${percent} percent remaining`}>
                    {percent}{percent !== '—' && <Text style={styles.percentSymbol}>%</Text>}
                </Text>
                <Text style={styles.remaining}>{percent === '—' ? 'not reported' : 'remaining'}</Text>
            </View>
            <UsageMeter remaining={window.remainingPercent} color={colors[severity]} label={`${window.scope ? `${window.scope}, ` : ''}${window.label}`} />
            <View style={styles.reset}>
                <Ionicons name="time-outline" size={14} color={theme.colors.textSecondary} style={{ marginTop: 2 }} />
                <View style={{ flex: 1 }}>
                    <Text style={styles.resetPrimary}>{resetCountdown(window.resetsAt, now)}</Text>
                    {resetDate && <Text style={styles.resetSecondary}>{resetDate}</Text>}
                </View>
            </View>
        </View>
    );
}

function Balance({ balance, first, now }: { balance: ProviderUsageBalance; first: boolean; now: number }) {
    const { theme } = useUnistyles();
    const colors = useUsageColors();
    // A provider's `hasCredits: false` still means a reported balance of zero.
    // Only paid extra usage has an on/off setting.
    const disabled = disabledUsageState(balance);
    const expired = balance.expiresAt !== null && balance.expiresAt <= now;
    const format = (value: number | null) => formatAllowance(value, balance.unit, balance.currency);
    const value = disabled ? disabled.label : balance.unlimited ? 'Unlimited' : format(balance.remaining);
    if (balance.kind === 'resets' && balance.expiresAt !== null) {
        return (
            <View style={[styles.resetDetail, !first && styles.divider]}>
                <View style={styles.resetDetailTop}>
                    <Text style={[styles.balanceTitle, { flex: 1 }]}>{balance.label}</Text>
                    <Text style={styles.resetDetailValue}>{value}{balance.remaining === null ? '' : expired ? ' recorded' : ' available'}</Text>
                </View>
                <Text style={[styles.resetSecondary, expired && { color: colors.caution }]}>{expired ? 'Expired' : 'Expires'} {formatUsageDate(balance.expiresAt) ?? 'at an unknown time'}{expired ? ' · refresh to check availability' : ''}</Text>
            </View>
        );
    }
    const details = [
        balance.used !== null ? `${format(balance.used)} used` : null,
        balance.limit !== null ? `${format(balance.limit)} ${balance.kind === 'spend_limit' ? 'spending limit' : 'allowance'}` : null,
    ].filter(Boolean).join(' · ');
    const suffix = disabled ? '' : balanceRemainingSuffix(balance, expired);
    return (
        <View style={[styles.balance, !first && styles.divider]}>
            <View style={styles.balanceTop}>
                <Ionicons name={balance.kind === 'resets' ? 'refresh-outline' : balance.kind === 'credits' ? 'layers-outline' : 'wallet-outline'} size={15} color={theme.colors.textSecondary} />
                <Text style={styles.balanceTitle}>{balance.label}</Text>
            </View>
            <Text style={styles.balanceValue}>{value}<Text style={styles.balanceSuffix}>{suffix}</Text></Text>
            {details.length > 0 && <Text style={styles.small}>{details}</Text>}
            {balance.kind === 'spend_limit' && balance.usedPercent !== null && !disabled && !balance.unlimited && (
                <>
                    <UsageMeter remaining={Math.max(0, Math.min(100, 100 - balance.usedPercent))} color={colors[usageSeverity(balance.usedPercent)]} label={`${balance.label} spending allowance`} />
                    <Text style={[styles.small, { color: colors[usageSeverity(balance.usedPercent)] }]}>{severityLabels[usageSeverity(balance.usedPercent)]}</Text>
                </>
            )}
            {balance.kind === 'credits' && balance.remaining === 0 && !balance.unlimited && <Text style={[styles.small, { color: colors.exhausted }]}>{balance.unit === 'currency' ? 'No prepaid balance remaining' : 'No credits remaining'}</Text>}
            {disabled && <Text style={[styles.small, { color: colors[disabled.severity] }]}>{disabled.explanation}</Text>}
            {balance.kind === 'credits' && !disabled && <Text style={styles.small}>{balance.unit === 'currency' ? 'Prepaid balance for usage beyond your plan limits.' : 'Credits extend usage beyond your plan limits.'}</Text>}
            {balance.resetsAt !== null && <Text style={styles.small}>{resetCountdown(balance.resetsAt, now)}{formatUsageDate(balance.resetsAt) ? ` · ${formatUsageDate(balance.resetsAt)}` : ''}</Text>}
            {balance.expiresAt !== null && <Text style={[styles.small, expired && { color: colors.caution }]}>{expired ? 'Expired' : 'Expires'} {formatUsageDate(balance.expiresAt) ?? 'at an unknown time'}{expired ? ' · refresh to check availability' : ''}</Text>}
        </View>
    );
}

function AccountEmptyState({ entry, loading }: { entry: ProviderUsageEntry; loading: boolean }) {
    const { theme } = useUnistyles();
    const providerName = entry.provider === 'codex' ? 'Codex' : 'Claude';
    const status = entry.snapshot?.status;
    const needsUpdate = !!entry.error && /Update Talos|Update the Talos CLI/.test(entry.error);
    const title = !entry.online ? 'Machine is offline'
        : loading ? 'Checking your allowance'
            : needsUpdate ? 'Update Talos on your computers'
            : status === 'unauthenticated' ? `Sign in to ${providerName}`
                : status === 'unsupported' ? 'Plan limits unavailable'
                    : 'Usage is unavailable';
    const description = !entry.online ? 'Reconnect this machine to read the account’s latest usage.'
        : loading ? `Fetching account limits from ${providerName}.`
            : status === 'unauthenticated' ? `Sign in to ${providerName} on this machine, then refresh.`
                : entry.snapshot?.message ?? entry.error ?? 'The provider has not returned an account allowance. Try refreshing in a moment.';
    return (
        <View style={styles.empty}>
            <View style={styles.emptyIcon}>
                {loading && entry.online ? <ActivityIndicator color={theme.colors.accent} />
                    : <Ionicons name={!entry.online ? 'cloud-offline-outline' : status === 'unauthenticated' ? 'key-outline' : 'hourglass-outline'} size={25} color={theme.colors.accent} />}
            </View>
            <Text style={styles.emptyTitle}>{title}</Text>
            {entry.sources && entry.sources.length > 1 ? <View style={{ alignSelf: 'stretch', gap: 12 }}>
                {entry.sources.map(source => <View key={source.machineId} style={{ gap: 3 }}>
                    <Text style={styles.account}>{source.label}</Text>
                    <Text style={styles.small}>{!source.online ? 'Offline · reconnect to check usage'
                        : source.refreshing ? 'Checking account limits…' : source.message ?? description}</Text>
                </View>)}
            </View> : <Text style={styles.emptyDescription}>{description}</Text>}
        </View>
    );
}

function AccountCard({ entry, now, width }: { entry: ProviderUsageEntry; now: number; width: '100%' | number }) {
    const { theme } = useUnistyles();
    const snapshot = entry.snapshot;
    const hasData = !!snapshot && (snapshot.windows.length > 0 || snapshot.balances.length > 0);
    const stale = !entry.online || snapshot?.freshness === 'stale';
    const badge = !entry.online ? 'Offline' : entry.refreshing ? 'Checking' : stale ? 'Saved reading' : snapshot?.account?.plan;
    const freshness = !entry.online ? 'Last saved reading'
        : snapshot?.freshness === 'stale' ? 'Saved reading · may be out of date'
            : snapshot?.freshness === 'provider_cache_possible' ? 'Provider may return cached usage'
                : snapshot?.freshness === 'cached' ? 'Saved recently' : null;
    return (
        <View style={[styles.card, { width }]} testID={`provider-usage-${entry.provider}`}>
            <View style={styles.cardHeader}>
                {!!badge && <View style={[styles.badge, { alignSelf: 'flex-start' }]}><Text style={styles.badgeText}>{badge}</Text></View>}
                <View style={styles.identity}>
                    <Text style={styles.account} selectable testID="usage-account-label">{snapshot?.account?.label ?? (entry.refreshing ? 'Finding your account' : 'Account not identified')}</Text>
                    <View style={styles.identityRow}>
                        <Ionicons name="desktop-outline" size={12} color={theme.colors.textSecondary} />
                        <Text style={[styles.small, { flex: 1 }]} testID="usage-machine-label">{entry.machineLabel}</Text>
                    </View>
                </View>
            </View>
            {hasData ? (
                <>
                    {sortUsageWindows(snapshot.windows).map((window, index) => <LimitWindow key={window.id} window={window} primary={index === 0} now={now} />)}
                    {snapshot.windows.length === 0 && <View style={styles.window}><Text style={styles.notice}>Your provider has not reported subscription limits for this account.</Text></View>}
                    {snapshot.balances.length > 0 && <View style={styles.balances}>{snapshot.balances.map((balance, index) => <Balance key={balance.id} balance={balance} first={index === 0} now={now} />)}</View>}
                </>
            ) : <AccountEmptyState entry={entry} loading={entry.refreshing} />}
            <View style={styles.cardFooter}>
                <View style={styles.footerRow}>
                    <Text style={styles.footerText} accessibilityLabel={snapshot ? `Last checked ${formatUsageDate(snapshot.checkedAt)}` : 'Not checked yet'}>{checkedAgo(snapshot?.checkedAt ?? null, now)}</Text>
                    {entry.refreshing && <ActivityIndicator size="small" color={theme.colors.accent} />}
                </View>
                {freshness && hasData && <Text style={styles.footerText}>{freshness}</Text>}
                {hasData && snapshot?.dataAsOf !== null && snapshot?.dataAsOf !== undefined && (stale || !!entry.error) && <Text style={styles.footerText}>Usage as of {formatUsageDate(snapshot.dataAsOf)}</Text>}
                {hasData && snapshot?.message && <Text style={styles.notice}>{snapshot.message}</Text>}
                {hasData && entry.error && entry.error !== snapshot?.message && <Text style={styles.notice}>{entry.error}</Text>}
            </View>
        </View>
    );
}

function LimitsToWatch({ entries, now }: { entries: ProviderUsageEntry[]; now: number }) {
    const { theme } = useUnistyles();
    const colors = useUsageColors();
    const [expanded, setExpanded] = React.useState(false);
    const limits = entries.flatMap(entry => {
        if (!entry.snapshot) return [];
        const provider = entry.provider === 'codex' ? 'Codex' : 'Claude';
        const saved = !entry.online || entry.snapshot.freshness === 'stale' || !!entry.error;
        const windows = entry.snapshot.windows
            .filter(window => window.usedPercent !== null && window.usedPercent >= 80)
            .map(window => ({
                key: `${entry.key}:${window.id}`,
                label: `${provider} · ${window.scope ? `${window.scope} · ` : ''}${window.label}`,
                remaining: `${formatRemainingPercent(window.remainingPercent)}${window.remainingPercent === null ? '' : '%'} remaining`,
                usedPercent: window.usedPercent!, resetsAt: window.resetsAt,
            }));
        const balances = entry.snapshot.balances
            .filter(balance => balance.kind === 'spend_limit' && (balance.enabled !== false || balance.disabledReason === 'spend_limit_reached') && !balance.unlimited && balance.usedPercent !== null && balance.usedPercent >= 80)
            .map(balance => ({
                key: `${entry.key}:${balance.id}`,
                label: `${provider} · ${balance.label}`,
                remaining: `${formatAllowance(balance.remaining, balance.unit, balance.currency)}${balance.unit === 'credits' ? ' credits' : ''} left to spend`,
                usedPercent: balance.usedPercent!, resetsAt: balance.resetsAt,
            }));
        return [...windows, ...balances].map(limit => ({ ...limit, machineLabel: entry.machineLabel, saved }));
    }).sort((a, b) => b.usedPercent - a.usedPercent);
    if (!limits.length) return null;
    return (
        <View style={styles.attention}>
            <View style={styles.attentionHeading}>
                <Ionicons name="alert-circle-outline" size={17} color={theme.colors.accent} />
                <Text style={styles.attentionTitle}>Limits to watch · {limits.length}</Text>
            </View>
            {(expanded ? limits : limits.slice(0, 2)).map(limit => (
                <View key={limit.key} style={styles.attentionItem}>
                    <Text style={styles.attentionName}>{limit.label}</Text>
                    <Text style={[styles.small, { color: colors[usageSeverity(limit.usedPercent)] }]}>{severityLabels[usageSeverity(limit.usedPercent)]} · {limit.remaining}</Text>
                    <Text style={styles.small}>{resetCountdown(limit.resetsAt, now)} · {limit.machineLabel}{limit.saved ? ' · last known reading' : ''}</Text>
                </View>
            ))}
            {limits.length > 2 && <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                onPress={() => setExpanded(value => !value)}
                style={{ minHeight: 36, justifyContent: 'center', alignSelf: 'flex-start' }}
            >
                <Text style={[styles.small, { color: theme.colors.text, fontWeight: '600' }]}>
                    {expanded ? 'Show fewer' : `Show ${limits.length - 2} more limits`}
                </Text>
            </Pressable>}
        </View>
    );
}

/** Sources without a verified identity never become account cards. Their
 * diagnostics and any unidentified readings remain available on demand. */
function UsageConnections({ entries, now }: { entries: ProviderUsageEntry[]; now: number }) {
    const { theme } = useUnistyles();
    const [expanded, setExpanded] = React.useState(false);
    if (!entries.length) return null;
    const machines = new Set(entries.flatMap(entry => entry.machineIds));
    const checking = entries.some(entry => entry.refreshing);
    return <View style={[styles.card, { width: '100%' }]} testID="usage-connections">
        <Pressable accessibilityRole="button" accessibilityState={{ expanded }}
            accessibilityLabel="Connection details" onPress={() => setExpanded(value => !value)}
            style={[styles.cardHeader, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
            <Ionicons name="desktop-outline" size={20} color={theme.colors.textSecondary} />
            <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.account}>Connection details</Text>
                <Text style={styles.small}>{checking ? 'Checking connected computers…' : `${machines.size} ${machines.size === 1 ? 'computer has' : 'computers have'} unverified connections`}</Text>
            </View>
            <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.textSecondary} />
        </Pressable>
        {expanded && <View style={{ padding: 20, gap: 20 }}>
            <Text style={styles.small}>These connections have not identified an account. They are not additional subscriptions.</Text>
            {entries.map(entry => <View key={entry.key} style={{ gap: 8 }}>
                <Text style={styles.account}>{entry.provider === 'codex' ? 'Codex' : 'Claude'}</Text>
                {(entry.sources ?? [{ machineId: entry.machineId, label: entry.machineLabel, online: entry.online, refreshing: entry.refreshing, message: entry.error ?? entry.snapshot?.message }]).map(source =>
                    <View key={source.machineId} style={{ gap: 3 }}>
                        <Text style={styles.account}>{source.label}</Text>
                        <Text style={styles.small}>{!source.online ? 'Offline' : source.refreshing ? 'Checking…' : source.message ?? 'Account identity could not be verified. Update Talos on this computer and refresh.'}</Text>
                    </View>)}
                {!!entry.snapshot?.windows.length && <>
                    <Text style={styles.notice}>Usage reported by this computer · account unverified</Text>
                    {sortUsageWindows(entry.snapshot.windows).map(window => <LimitWindow key={window.id} window={window} primary={false} now={now} />)}
                </>}
                {!!entry.snapshot?.balances.length && entry.snapshot.balances.map((balance, index) => <Balance key={balance.id} balance={balance} first={index === 0} now={now} />)}
            </View>)}
        </View>}
    </View>;
}

export const AccountUsageDashboard = React.memo(function AccountUsageDashboard({ entries, loading, refreshing, refresh, machineCount }: AccountUsageDashboardProps) {
    const { theme } = useUnistyles();
    const [now, setNow] = React.useState(Date.now);
    const [contentWidth, setContentWidth] = React.useState(0);
    React.useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 15_000);
        return () => clearInterval(interval);
    }, []);
    const { accounts: orderedEntries, connections } = React.useMemo(() => partitionProviderUsageEntries(entries), [entries]);
    const cardWidth = contentWidth >= 800 ? (contentWidth - 18) / 2 : '100%';
    const providers = ['codex', 'claude'] as const;
    return (
        <View style={styles.dashboard}>
            <View style={styles.heading}>
                <Text style={styles.eyebrow}>YOUR ACCOUNTS</Text>
                <Text style={styles.title} accessibilityRole="header">Usage & limits</Text>
                <Text style={styles.subtitle}>See how much room you have to work, and when your next allowance resets.</Text>
            </View>
            <View style={styles.toolbar}>
                <View style={styles.scopeNote}>
                    <Ionicons name="layers-outline" size={14} color={theme.colors.textSecondary} />
                    <Text style={styles.small}>Account limits · all sessions</Text>
                </View>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Refresh account usage"
                    accessibilityState={{ disabled: refreshing || machineCount === 0, busy: refreshing }}
                    disabled={refreshing || machineCount === 0}
                    onPress={refresh}
                    style={({ pressed }) => [styles.refresh, pressed && { backgroundColor: theme.colors.surfacePressed }, machineCount === 0 && { opacity: 0.5 }]}
                >
                    {refreshing ? <ActivityIndicator size="small" color={theme.colors.accent} /> : <Ionicons name="refresh-outline" size={15} color={theme.colors.text} />}
                    <Text style={styles.refreshLabel}>{refreshing ? 'Refreshing' : 'Refresh'}</Text>
                </Pressable>
            </View>
            <LimitsToWatch entries={orderedEntries} now={now} />
            <View style={styles.grid} onLayout={(event) => setContentWidth(event.nativeEvent.layout.width)}>
                {providers.map(provider => {
                    const accounts = orderedEntries.filter(entry => entry.provider === provider);
                    if (!accounts.length) return null;
                    return <View key={provider} style={{ width: cardWidth, gap: 12 }} testID={`usage-provider-group-${provider}`}>
                        <View style={[styles.providerRow, { paddingHorizontal: 4 }]}>
                            <View style={styles.providerIcon}>
                                <Ionicons name={provider === 'codex' ? 'terminal-outline' : 'sparkles-outline'} size={22} color={theme.colors.accent} />
                            </View>
                            <View>
                                <Text style={styles.provider} accessibilityRole="header">{provider === 'codex' ? 'Codex' : 'Claude'}</Text>
                                <Text style={styles.providerDescription}>{provider === 'codex' ? 'OpenAI' : 'Anthropic'}</Text>
                            </View>
                        </View>
                        {accounts.map(entry => <AccountCard key={entry.key} entry={entry} now={now} width="100%" />)}
                    </View>;
                })}
                {orderedEntries.length === 0 && (
                    <View style={styles.card}>
                        <View style={styles.empty}>
                            <View style={styles.emptyIcon}>{loading ? <ActivityIndicator color={theme.colors.accent} /> : <Ionicons name="desktop-outline" size={28} color={theme.colors.accent} />}</View>
                            <Text style={styles.emptyTitle}>{loading ? 'Finding your accounts' : machineCount === 0 ? 'Your limits start here' : 'No accounts identified yet'}</Text>
                            <Text style={styles.emptyDescription}>{loading ? 'Checking your connected machines.' : machineCount === 0 ? 'Connect a machine running Talos, then sign in to Codex or Claude there. Your account limits will appear here.' : 'Install and sign in to Codex or Claude on a connected machine to see its account limits.'}</Text>
                        </View>
                    </View>
                )}
            </View>
            <UsageConnections entries={connections} now={now} />
            <View style={styles.footnote}>
                <Ionicons name="information-circle-outline" size={15} color={theme.colors.textSecondary} style={{ marginTop: 1 }} />
                <Text style={[styles.small, { flex: 1 }]}>These are your provider’s account allowances, including usage outside Talos. Separate accounts and model limits are shown individually.</Text>
            </View>
        </View>
    );
});
