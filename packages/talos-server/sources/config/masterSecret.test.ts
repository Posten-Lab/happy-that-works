import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMasterSecret } from './masterSecret';

afterEach(() => vi.unstubAllEnvs());

describe('Talos master secret configuration', () => {
    it('uses the Talos secret when both names are present', () => {
        vi.stubEnv('TALOS_MASTER_SECRET', 'new-test-secret');
        vi.stubEnv('HANDY_MASTER_SECRET', 'previous-test-secret');
        expect(getMasterSecret()).toBe('new-test-secret');
    });
    it('preserves existing deployments without rotating their secret', () => {
        vi.stubEnv('TALOS_MASTER_SECRET', undefined);
        vi.stubEnv('HANDY_MASTER_SECRET', 'previous-test-secret');
        expect(getMasterSecret()).toBe('previous-test-secret');
    });
    it('fails with the Talos setting name when no secret is provided', () => {
        vi.stubEnv('TALOS_MASTER_SECRET', undefined);
        vi.stubEnv('HANDY_MASTER_SECRET', undefined);
        expect(() => getMasterSecret()).toThrow('TALOS_MASTER_SECRET is required');
    });
});
