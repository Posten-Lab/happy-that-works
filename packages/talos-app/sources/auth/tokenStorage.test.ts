import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
    platform: { OS: 'ios' },
    getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn(),
}));
vi.mock('react-native', () => ({ Platform: native.platform }));
vi.mock('expo-secure-store', () => native);
import { TokenStorage } from './tokenStorage';

describe('native account continuity after the store update', () => {
    beforeEach(() => vi.clearAllMocks());

    it.each(['ios', 'android'])('reads the installed %s account and full secret without rewriting storage', async platform => {
        native.platform.OS = platform;
        // Shape and key used by the installed 1.7.0 binary; intentionally synthetic.
        const installed = { token: 'installed-account-token', secret: Buffer.alloc(32, 7).toString('base64url') };
        const stored = JSON.stringify(installed);
        native.getItemAsync.mockResolvedValue(stored);
        expect(await TokenStorage.getCredentials()).toEqual(installed);
        expect(native.getItemAsync).toHaveBeenCalledExactlyOnceWith('auth_credentials');
        // No new service/access-group options: these would hide the installed keychain item.
        expect(native.setItemAsync).not.toHaveBeenCalled();
        expect(native.deleteItemAsync).not.toHaveBeenCalled();
    });
});
