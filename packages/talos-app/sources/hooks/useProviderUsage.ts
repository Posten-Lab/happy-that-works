import * as React from 'react';
import { AppState, Platform } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useAuth } from '@/auth/AuthContext';
import { useAllMachines, useSocketStatus } from '@/sync/storage';
import { isMachineOnline } from '@/utils/machineUtils';
import {
    mergeProviderUsageEntries, readProviderUsage, requiresUsageCliUpdate, USAGE_CLI_UPDATE_MESSAGE,
    type ProviderUsageEntry, type UsageProvider,
} from '@/sync/providerUsage';

const REFRESH_INTERVAL_MS = 5 * 60_000;
const PROVIDERS: UsageProvider[] = ['codex', 'claude'];

function isForeground() {
    return AppState.currentState !== 'background' && AppState.currentState !== 'inactive'
        && (Platform.OS !== 'web' || typeof document === 'undefined' || document.visibilityState !== 'hidden');
}

export function useProviderUsage() {
    const machines = useAllMachines({ includeOffline: true });
    const { status: socketStatus } = useSocketStatus();
    const { credentials } = useAuth();
    const focused = useIsFocused();
    const [foreground, setForeground] = React.useState(isForeground);
    const [refreshNonce, setRefreshNonce] = React.useState(0);
    const lastManualRefresh = React.useRef(0);
    const scope = credentials?.token ?? null;
    const [state, setState] = React.useState<{
        scope: string | null; entries: Record<string, ProviderUsageEntry>;
    }>({ scope, entries: {} });
    const latestEntries = React.useRef(state.entries);
    latestEntries.current = state.scope === scope ? state.entries : {};
    const inflight = React.useRef(new Map<string, Promise<Awaited<ReturnType<typeof readProviderUsage>>>>());
    const authScope = React.useRef(scope);
    if (authScope.current !== scope) {
        authScope.current = scope;
        inflight.current = new Map();
    }
    const machineKey = JSON.stringify(machines.map(machine => ({
        id: machine.id,
        label: machine.metadata?.displayName || machine.metadata?.host || 'Computer',
        online: isMachineOnline(machine),
        needsUpdate: requiresUsageCliUpdate(machine.metadata),
    })).sort((a, b) => a.id.localeCompare(b.id)));

    React.useEffect(() => {
        const changed = () => setForeground(isForeground());
        const subscription = AppState.addEventListener('change', changed);
        if (Platform.OS === 'web' && typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', changed);
        }
        return () => {
            subscription.remove();
            if (Platform.OS === 'web' && typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', changed);
            }
        };
    }, []);

    React.useEffect(() => {
        const descriptors = JSON.parse(machineKey) as Array<{ id: string; label: string; online: boolean; needsUpdate: boolean }>;
        let cancelled = false;
        const canRead = !!scope && focused && foreground && socketStatus === 'connected';
        const requestPool = inflight.current;
        const deferred = new Map<string, ReturnType<typeof setTimeout>>();
        setState(previous => {
            const entries: Record<string, ProviderUsageEntry> = {};
            for (const machine of descriptors) {
                for (const provider of PROVIDERS) {
                    const key = `${machine.id}:${provider}`;
                    const prior = previous.scope === scope ? previous.entries[key] : undefined;
                    entries[key] = {
                        ...prior, key, provider, machineId: machine.id, machineIds: [machine.id],
                        machineLabel: machine.label, online: machine.online && socketStatus === 'connected',
                        refreshing: canRead && machine.online && !machine.needsUpdate, snapshot: prior?.snapshot ?? null,
                        error: machine.needsUpdate ? USAGE_CLI_UPDATE_MESSAGE : prior?.error,
                    };
                }
            }
            return { scope, entries };
        });
        if (!canRead) return () => { cancelled = true; };

        const succeeded = new Set<string>();
        const refresh = (force: boolean, onlyFailed = false, onlyKey?: string) => {
            for (const machine of descriptors.filter(m => m.online && !m.needsUpdate)) {
                for (const provider of PROVIDERS) {
                    const key = `${machine.id}:${provider}`;
                    if (onlyKey && key !== onlyKey) continue;
                    if (onlyFailed && succeeded.has(key)) continue;
                    const retryAt = latestEntries.current[key]?.snapshot?.retryAt;
                    if (retryAt && retryAt > Date.now()) {
                        // Respect the daemon's request bound, including when a
                        // reset occurs just after a successful account read.
                        setState(previous => previous.scope !== scope || !previous.entries[key] ? previous : ({
                            scope, entries: { ...previous.entries, [key]: { ...previous.entries[key], refreshing: false } },
                        }));
                        if (!deferred.has(key)) deferred.set(key, setTimeout(() => {
                            deferred.delete(key);
                            if (!cancelled) refresh(force, onlyFailed, key);
                        }, Math.min(retryAt - Date.now() + 50, 2_147_483_647)));
                        continue;
                    }
                    setState(previous => previous.scope !== scope || !previous.entries[key] ? previous : ({
                        scope, entries: { ...previous.entries, [key]: { ...previous.entries[key], refreshing: true } },
                    }));
                    let request = requestPool.get(key);
                    if (!request) {
                        request = readProviderUsage(machine.id, provider, force);
                        requestPool.set(key, request);
                        const ownedRequest = request;
                        void request.finally(() => {
                            if (requestPool.get(key) === ownedRequest) requestPool.delete(key);
                        }).catch(() => {});
                    }
                    void request.then(snapshot => {
                        if (cancelled) return;
                        if (snapshot.status !== 'error') succeeded.add(key);
                        setState(previous => previous.scope !== scope || !previous.entries[key] ? previous : ({
                            scope, entries: { ...previous.entries, [key]: {
                                ...previous.entries[key], snapshot, refreshing: false, error: undefined,
                            } },
                        }));
                        if ((snapshot.status === 'unavailable' || snapshot.status === 'error' || snapshot.freshness === 'stale')
                            && snapshot.retryAt && snapshot.retryAt > Date.now() && !deferred.has(key)) {
                            deferred.set(key, setTimeout(() => {
                                deferred.delete(key);
                                if (!cancelled) refresh(true, false, key);
                            }, Math.min(snapshot.retryAt - Date.now() + 50, 2_147_483_647)));
                        }
                    }).catch((error: unknown) => {
                        if (cancelled) return;
                        setState(previous => {
                            if (previous.scope !== scope || !previous.entries[key]) return previous;
                            const prior = previous.entries[key];
                            return { scope, entries: { ...previous.entries, [key]: {
                                ...prior, refreshing: false,
                                snapshot: prior.snapshot ? { ...prior.snapshot, freshness: 'stale' } : null,
                                error: error instanceof Error ? error.message : 'Usage could not be refreshed. Try again.',
                            } } };
                        });
                    });
                }
            }
        };
        refresh(refreshNonce !== lastManualRefresh.current);
        lastManualRefresh.current = refreshNonce;
        // Machine encryption can finish restoring just after socket connection.
        // Retry only failed/empty reads; don't double-poll a healthy provider.
        const retry = setTimeout(() => {
            if (!cancelled) refresh(false, true);
        }, 10_000);
        const interval = setInterval(() => refresh(false), REFRESH_INTERVAL_MS);
        return () => {
            cancelled = true;
            clearTimeout(retry);
            clearInterval(interval);
            deferred.forEach(clearTimeout);
        };
    }, [machineKey, scope, focused, foreground, socketStatus, refreshNonce]);

    const entries = React.useMemo(() => mergeProviderUsageEntries(
        state.scope === scope ? Object.values(state.entries) : [],
    ), [state, scope]);
    const refresh = React.useCallback(() => setRefreshNonce(value => value + 1), []);
    const nextReset = entries.flatMap(entry => entry.online && entry.snapshot ? [
        ...entry.snapshot.windows.map(window => window.resetsAt),
        ...entry.snapshot.balances.map(balance => balance.resetsAt),
    ] : []).filter((reset): reset is number => reset !== null && reset > Date.now())
        .sort((a, b) => a - b)[0];
    React.useEffect(() => {
        if (!focused || !foreground || socketStatus !== 'connected' || nextReset === undefined) return;
        const timer = setTimeout(refresh, Math.min(nextReset - Date.now() + 1_000, 2_147_483_647));
        return () => clearTimeout(timer);
    }, [nextReset, focused, foreground, socketStatus, refresh]);
    return {
        entries,
        loading: entries.some(entry => entry.refreshing && !entry.snapshot),
        refreshing: entries.some(entry => entry.refreshing),
        refresh,
        machineCount: machines.length,
    };
}
