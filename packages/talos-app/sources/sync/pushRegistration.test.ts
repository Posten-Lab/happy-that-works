import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    constants: { expoConfig: { extra: { eas: { projectId: undefined as string | undefined } } } },
    permissions: vi.fn(), request: vi.fn(), pushToken: vi.fn(),
    register: vi.fn(), save: vi.fn(),
}));

vi.mock('expo-constants', () => ({ default: mocks.constants }));
vi.mock('expo-application', () => ({}));
vi.mock('expo-device', () => ({}));
vi.mock('react-native', () => ({ Platform: { OS: 'android' }, Linking: { openSettings: vi.fn() } }));
vi.mock('expo-notifications', () => ({
    getPermissionsAsync: mocks.permissions,
    requestPermissionsAsync: mocks.request,
    getExpoPushTokenAsync: mocks.pushToken,
}));
vi.mock('./persistence', () => ({
    loadRegisteredPushToken: () => null,
    saveRegisteredPushToken: mocks.save,
    clearRegisteredPushToken: vi.fn(),
}));
vi.mock('./apiPush', () => ({ registerPushToken: mocks.register, unregisterPushToken: vi.fn() }));

import { syncCurrentPushToken } from './pushRegistration';

describe('push registration for a separate Talos installation', () => {
    const credentials = { token: 'local-test-token', secret: 'local-test-secret' };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.constants.expoConfig.extra.eas.projectId = undefined;
        mocks.permissions.mockResolvedValue({ status: 'undetermined', canAskAgain: true });
        mocks.request.mockResolvedValue({ status: 'granted', granted: true });
        mocks.pushToken.mockResolvedValue({ data: 'ExponentPushToken[local-fixture]' });
        mocks.register.mockResolvedValue(undefined);
    });

    it('finishes local account setup without asking for unusable push permission', async () => {
        expect(await syncCurrentPushToken(credentials)).toMatchObject({ registered: false, token: null });
        expect(mocks.request).not.toHaveBeenCalled();
        expect(mocks.pushToken).not.toHaveBeenCalled();
        expect(mocks.register).not.toHaveBeenCalled();
    });

    it('registers with the configured Talos project after permission is granted', async () => {
        mocks.constants.expoConfig.extra.eas.projectId = 'talos-project-fixture';
        expect(await syncCurrentPushToken(credentials)).toMatchObject({ registered: true });
        expect(mocks.pushToken).toHaveBeenCalledWith({ projectId: 'talos-project-fixture' });
        expect(mocks.register).toHaveBeenCalledWith(credentials, 'ExponentPushToken[local-fixture]');
    });

    it('allows account setup when notification permission is denied', async () => {
        mocks.constants.expoConfig.extra.eas.projectId = 'talos-project-fixture';
        mocks.request.mockResolvedValue({ status: 'denied', canAskAgain: false });
        expect(await syncCurrentPushToken(credentials)).toMatchObject({ registered: false });
        expect(mocks.pushToken).not.toHaveBeenCalled();
        expect(mocks.register).not.toHaveBeenCalled();
    });
});
