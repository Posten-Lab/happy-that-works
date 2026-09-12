import { AppState } from 'react-native';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { TokenStorage, type AuthCredentials } from '@/auth/tokenStorage';
import { decodeBase64 } from '@/encryption/base64';
import sodium from '@/encryption/libsodium.lib';
import { Encryption } from '../encryption/encryption';
import { configureSessionSearch, sessionSearch } from './sessionSearch';

const TASK = 'talos-session-search';
const appIsActive = () => AppState.currentState === 'active';
let epoch = 0;
let enabled = true;
let subscription: ReturnType<typeof AppState.addEventListener> | undefined;
let registration: Promise<void> = Promise.resolve();

// Defined at module scope so the OS can launch it without opening a screen.
TaskManager.defineTask(TASK, async () => {
    if (!enabled || appIsActive()) return BackgroundTask.BackgroundTaskResult.Success;
    const currentEpoch = epoch;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
        if (!sessionSearch.isConfigured()) {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials || currentEpoch !== epoch || !enabled) return BackgroundTask.BackgroundTaskResult.Success;
            await sodium.ready;
            const encryption = await Encryption.create(decodeBase64(credentials.secret, 'base64url'));
            if (currentEpoch !== epoch || !enabled) return BackgroundTask.BackgroundTaskResult.Success;
            if (!sessionSearch.isConfigured()) configureSessionSearch(credentials, encryption);
        }
        // Commit progress page by page and leave time for the OS to suspend us.
        deadline = setTimeout(() => {
            if (currentEpoch === epoch && AppState.currentState !== 'active') sessionSearch.stop();
        }, 20_000);
        await sessionSearch.start({ refresh: false });
        return sessionSearch.getSnapshot().error
            ? BackgroundTask.BackgroundTaskResult.Failed
            : BackgroundTask.BackgroundTaskResult.Success;
    } catch {
        return BackgroundTask.BackgroundTaskResult.Failed;
    } finally {
        if (deadline) clearTimeout(deadline);
        if (currentEpoch === epoch && appIsActive()) void sessionSearch.start();
    }
});

export function startSearchIndexing(credentials: AuthCredentials) {
    enabled = true;
    const currentEpoch = ++epoch;
    subscription?.remove();
    subscription = AppState.addEventListener('change', state => {
        if (state === 'active') void sessionSearch.start();
        else if (state === 'background') sessionSearch.stop();
    });
    if (appIsActive()) void sessionSearch.start();
    registration = registration.catch(() => {}).then(async () => {
        if (currentEpoch !== epoch || !enabled) return;
        // Keep the installed keychain item, making it available to the scheduled
        // task after the first unlock. The account secret never leaves the device.
        if (!await TokenStorage.setCredentials(credentials) || currentEpoch !== epoch || !enabled) return;
        await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 15 });
    }).catch(() => { /* Foreground indexing remains available if the OS restricts tasks. */ });
}

export async function stopSearchIndexing() {
    enabled = false;
    ++epoch;
    subscription?.remove();
    subscription = undefined;
    sessionSearch.stop();
    await registration;
    if (await TaskManager.isTaskRegisteredAsync(TASK)) await BackgroundTask.unregisterTaskAsync(TASK);
}
