import { describe, expect, it } from 'vitest';
import type { Machine, Session } from '@/sync/storageTypes';
import { resolveSessionResumeMachine } from './sessionResumeMachine';
const session = { metadata: { machineId: 'old', host: 'mac.tailnet.example' } } as Session;
const original = { id: 'old', active: false, metadata: { host: 'Mac.local', homeDir: '/Users/person', platform: 'darwin', arch: 'arm64' } } as Machine;
const current = { ...original, id: 'current', active: true };
describe('resume across daemon registration changes', () => {
    it('uses the live registration for the same host and OS user despite a different session host name', () => {
        expect(resolveSessionResumeMachine(session, { old: original, current })).toBe(current);
    });
    it('always prefers the original registration when it is online', () => {
        const online = { ...original, active: true };
        expect(resolveSessionResumeMachine(session, { old: online, current })).toBe(online);
    });
    it.each([{ host: 'Other.local' }, { homeDir: '/Users/other' }, { platform: 'linux' }, { arch: 'x64' }])('does not resume on another environment: %o', mismatch => {
        expect(resolveSessionResumeMachine(session, { old: original, current: { ...current, metadata: { ...current.metadata!, ...mismatch } } })).toBeNull();
    });
    it('does not guess between multiple live registrations', () => {
        expect(resolveSessionResumeMachine(session, { old: original, current, another: { ...current, id: 'another' } })).toBeNull();
    });
    it('does not use an offline replacement', () => {
        expect(resolveSessionResumeMachine(session, { old: original, current: { ...current, active: false } })).toBeNull();
    });
    it('requires the original machine metadata instead of choosing any online machine', () => {
        expect(resolveSessionResumeMachine(session, { current })).toBeNull();
        expect(resolveSessionResumeMachine(session, { old: { ...original, metadata: null }, current })).toBeNull();
    });
});
