import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ findSession: vi.fn(), updateSession: vi.fn() }));
vi.mock('@/storage/db', () => ({ db: {
    session: { findUnique: state.findSession, update: state.updateSession },
    machine: { findUnique: vi.fn(), update: vi.fn() },
} }));
vi.mock('@/utils/log', () => ({ log: vi.fn() }));
vi.mock('@/app/monitoring/metrics2', () => ({
    sessionCacheCounter: { inc: vi.fn() }, databaseUpdatesSkippedCounter: { inc: vi.fn() },
}));

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

it('awaits an in-flight activity flush and flushes later updates before shutdown completes', async () => {
    vi.useFakeTimers();
    const initial = Date.now();
    state.findSession.mockResolvedValue({ lastActiveAt: new Date(initial) });
    let finishFirst!: () => void;
    state.updateSession.mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve; }))
        .mockResolvedValue(undefined);
    const { activityCache } = await import('./sessionCache');
    expect(await activityCache.isSessionValid('session-1', 'account-1')).toBe(true);
    expect(activityCache.queueSessionUpdate('session-1', initial + 31_000)).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(state.updateSession).toHaveBeenCalledOnce();
    expect(activityCache.queueSessionUpdate('session-1', initial + 62_000)).toBe(true);
    let stopped = false;
    const stopping = activityCache.shutdown().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(state.updateSession).toHaveBeenCalledOnce();
    finishFirst();
    await stopping;
    expect(state.updateSession).toHaveBeenCalledTimes(2);
    expect(state.updateSession).toHaveBeenLastCalledWith({
        where: { id: 'session-1' }, data: { lastActiveAt: new Date(initial + 62_000), active: true },
    });
});
