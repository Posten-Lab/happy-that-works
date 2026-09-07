import { describe, expect, it } from 'vitest';
import { getMachineRecovery, getSessionRecovery, hasUnresolvedSessionRecovery } from './sessionRecovery';

describe('session recovery availability', () => {
    const failed = { sessionId: 'session', status: 'failed' as const, attempts: 3, updatedAt: 100 };
    const state = { recovery: { enabled: true, sessions: [failed] } };

    it('treats daemon-confirmed missing processes as disconnected until restored', () => {
        expect(hasUnresolvedSessionRecovery(getSessionRecovery(state, 'session'))).toBe(true);
        expect(hasUnresolvedSessionRecovery({ ...failed, status: 'restored' })).toBe(false);
        expect(hasUnresolvedSessionRecovery(undefined)).toBe(false);
    });

    it('ignores stale recovery records after intentional archive', () => {
        expect(getSessionRecovery(state, 'session', 'archived')).toBeUndefined();
        expect(getSessionRecovery(state, 'other')).toBeUndefined();
    });

    it('requires an advertised capability before offering recovery controls', () => {
        expect(getMachineRecovery({ pid: 123 })).toBeNull();
        expect(getMachineRecovery({ recovery: { enabled: true } })).toBeNull();
        expect(getMachineRecovery(state)?.enabled).toBe(true);
    });
});
