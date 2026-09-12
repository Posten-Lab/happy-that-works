import { describe, it, expect, vi } from 'vitest';
import type { Session, Machine } from '@/sync/storageTypes';
vi.mock('@/text', () => ({ t: (key: string) => key }));
import { getResumeAvailability } from './sessionResumeAvailability';
const session = { metadata: { machineId: 'host', codexThreadId: 'thread' } } as Session;
describe('standard in-app resume availability', () => {
    it('offers resume on an online host without an experiment or recovery setting', () => {
        expect(getResumeAvailability(session, { active: true } as Machine, false)).toMatchObject({ canResume: true, canShowResume: true });
    });
    it('explains an offline host rather than requiring a terminal command', () => {
        expect(getResumeAvailability(session, { active: false } as Machine, false)).toMatchObject({ canResume: false, canShowResume: true, message: 'sessionInfo.resumeSessionMachineOffline' });
    });
    it('does not launch a duplicate for an already connected session', () => {
        expect(getResumeAvailability(session, { active: true } as Machine, true)).toMatchObject({ canResume: false, canShowResume: false });
    });
    it('requires the provider history and original machine metadata', () => {
        expect(getResumeAvailability({ metadata: {} } as Session, null, false).canResume).toBe(false);
        expect(getResumeAvailability({ metadata: { machineId: 'host' } } as Session, { active: true } as Machine, false).canResume).toBe(false);
    });
});
