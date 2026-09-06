import { describe, expect, it, vi } from 'vitest';

const installed = vi.hoisted(() => ({
    stores: new Map<string, Map<string, string>>([
        ['server-config', new Map([['custom-server-url', 'https://private-relay.example.test']])],
        ['default', new Map([
            ['session-drafts', JSON.stringify({ 'existing-session': 'draft survives update' })],
            ['registered-push-token-v1', 'installed-push-token'],
        ])],
    ]),
    writes: vi.fn(),
}));
vi.mock('react-native-mmkv', () => ({
    MMKV: class {
        readonly values: Map<string, string>;
        constructor(options?: { id: string }) {
            this.values = installed.stores.get(options?.id || 'default') || new Map();
        }
        getString(key: string) { return this.values.get(key); }
        set = installed.writes;
        delete = installed.writes;
        clearAll = installed.writes;
    },
}));
import { getServerUrl } from './serverConfig';
import { loadRegisteredPushToken, loadSessionDrafts } from './persistence';

describe('installed native preferences', () => {
    it('retains an explicitly selected account relay, drafts, and push registration without writes', () => {
        expect(getServerUrl()).toBe('https://private-relay.example.test');
        expect(loadSessionDrafts()).toEqual({ 'existing-session': 'draft survives update' });
        expect(loadRegisteredPushToken()).toBe('installed-push-token');
        expect(installed.writes).not.toHaveBeenCalled();
    });
});
