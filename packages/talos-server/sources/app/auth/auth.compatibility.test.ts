import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as privacyKit from 'privacy-kit';
import { auth } from './auth';

const seed = 'talos-rebrand-compatibility-fixture-not-a-production-secret';

describe('authentication across an explicit server upgrade', () => {
    beforeAll(async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
        vi.stubEnv('TALOS_MASTER_SECRET', seed);
        await auth.init();
    });

    afterAll(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllEnvs();
    });

    it('verifies a persistent account token issued under the previous identity', async () => {
        const previous = await privacyKit.createPersistentTokenGenerator({ service: 'handy', seed });
        const token = await previous.new({ user: 'existing-account', extras: { role: 'user' } });
        expect(await auth.verifyToken(token)).toEqual({ userId: 'existing-account', extras: { role: 'user' } });
    });

    it('completes an OAuth flow started before the server upgrade', async () => {
        const previous = await privacyKit.createEphemeralTokenGenerator({ service: 'github-happy', seed, ttl: 300_000 });
        const token = await previous.new({ user: 'existing-account' });
        expect(await auth.verifyGithubToken(token)).toEqual({ userId: 'existing-account' });
    });

    it('rejects tokens from another installation with a different master secret', async () => {
        const other = await privacyKit.createPersistentTokenGenerator({ service: 'handy', seed: `${seed}-other` });
        expect(await auth.verifyToken(await other.new({ user: 'existing-account' }))).toBeNull();
    });
});
