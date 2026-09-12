import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({
    appState: { currentState: 'active', addEventListener: vi.fn() },
    defineTask: vi.fn(), registerTaskAsync: vi.fn(), unregisterTaskAsync: vi.fn(), isTaskRegisteredAsync: vi.fn(),
    getCredentials: vi.fn(), setCredentials: vi.fn(), createEncryption: vi.fn(),
    configure: vi.fn(), configured: true, start: vi.fn(), stop: vi.fn(), error: null as string | null,
}));
vi.mock('react-native', () => ({ AppState: native.appState }));
vi.mock('expo-background-task', () => ({ BackgroundTaskResult: { Success: 1, Failed: 2 }, registerTaskAsync: native.registerTaskAsync, unregisterTaskAsync: native.unregisterTaskAsync }));
vi.mock('expo-task-manager', () => ({ defineTask: native.defineTask, isTaskRegisteredAsync: native.isTaskRegisteredAsync }));
vi.mock('@/auth/tokenStorage', () => ({ TokenStorage: { getCredentials: native.getCredentials, setCredentials: native.setCredentials } }));
vi.mock('@/encryption/libsodium.lib', () => ({ default: { ready: Promise.resolve() } }));
vi.mock('../encryption/encryption', () => ({ Encryption: { create: native.createEncryption } }));
vi.mock('./sessionSearch', () => ({ configureSessionSearch: native.configure, sessionSearch: { isConfigured: () => native.configured, start: native.start, stop: native.stop, getSnapshot: () => ({ error: native.error }) } }));
const credentials = { token: 'test-token', secret: Buffer.alloc(32, 3).toString('base64url') };
let task: () => Promise<number>;
let module: typeof import('./backgroundSearch');
beforeEach(async () => {
    vi.resetModules(); vi.resetAllMocks(); vi.useFakeTimers();
    native.appState.currentState = 'active'; native.configured = true; native.error = null;
    native.appState.addEventListener.mockReturnValue({ remove: vi.fn() });
    native.setCredentials.mockResolvedValue(true); native.getCredentials.mockResolvedValue(credentials);
    native.registerTaskAsync.mockResolvedValue(undefined); native.isTaskRegisteredAsync.mockResolvedValue(true);
    native.start.mockResolvedValue(undefined);
    module = await import('./backgroundSearch');
    task = native.defineTask.mock.calls[0][1];
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
describe('account-owned indexing and scheduled background runs', () => {
    it('starts at account restoration without opening search and registers an OS task', async () => {
        module.startSearchIndexing(credentials);
        await vi.advanceTimersByTimeAsync(0);
        expect(native.start).toHaveBeenCalledOnce();
        expect(native.registerTaskAsync).toHaveBeenCalledWith('talos-session-search', { minimumInterval: 15 });
        expect(native.setCredentials).toHaveBeenCalledWith(credentials);
    });
    it('pauses on OS suspension and resumes on foreground activation, independently of screens', () => {
        module.startSearchIndexing(credentials);
        const change = native.appState.addEventListener.mock.calls[0][1];
        change('background'); expect(native.stop).toHaveBeenCalledOnce();
        change('active'); expect(native.start).toHaveBeenCalledTimes(2);
    });
    it('runs one background scan without installing a polling timer', async () => {
        native.appState.currentState = 'background';
        expect(await task()).toBe(1);
        expect(native.start).toHaveBeenCalledWith({ refresh: false });
        expect(vi.getTimerCount()).toBe(0);
    });
    it('restores encryption and the private cache when the OS starts a cold process', async () => {
        native.appState.currentState = 'background'; native.configured = false;
        const encryption = {}; native.createEncryption.mockResolvedValue(encryption);
        expect(await task()).toBe(1);
        expect(native.configure).toHaveBeenCalledWith(credentials, encryption);
    });
    it('does not configure an account when the keychain is unavailable or signed out', async () => {
        native.appState.currentState = 'background'; native.configured = false;
        native.getCredentials.mockResolvedValue(null);
        expect(await task()).toBe(1);
        expect(native.configure).not.toHaveBeenCalled(); expect(native.start).not.toHaveBeenCalled();
    });
    it('ends a long scan at its deadline so page checkpoints can be used next time', async () => {
        native.appState.currentState = 'background';
        let finish!: () => void; native.start.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
        native.stop.mockImplementation(() => finish());
        const running = task(); await vi.advanceTimersByTimeAsync(20_000); await running;
        expect(native.stop).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    });
    it('does not let a background deadline cancel a scan after returning to the app', async () => {
        native.appState.currentState = 'background';
        let finish!: () => void; native.start.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
        const running = task(); native.appState.currentState = 'active';
        await vi.advanceTimersByTimeAsync(20_000); expect(native.stop).not.toHaveBeenCalled();
        finish(); await running; expect(native.start).toHaveBeenLastCalledWith();
    });
    it('unregisters on logout and prevents a late task from restoring the old account', async () => {
        module.startSearchIndexing(credentials); await module.stopSearchIndexing();
        native.appState.currentState = 'background'; native.configured = false;
        await task(); expect(native.getCredentials).not.toHaveBeenCalled();
        expect(native.unregisterTaskAsync).toHaveBeenCalledWith('talos-session-search');
    });
    it('does not restore an account if logout happens during credential retrieval', async () => {
        native.appState.currentState = 'background'; native.configured = false;
        let resolve!: (value: typeof credentials) => void;
        native.getCredentials.mockImplementation(() => new Promise(r => { resolve = r; }));
        const running = task(); await module.stopSearchIndexing(); resolve(credentials); await running;
        expect(native.configure).not.toHaveBeenCalled();
    });
    it('reports failures so the OS can retry later', async () => {
        native.appState.currentState = 'background'; native.error = 'network interrupted';
        expect(await task()).toBe(2);
    });
});
