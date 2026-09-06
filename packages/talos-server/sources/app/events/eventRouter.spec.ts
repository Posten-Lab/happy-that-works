import { describe, expect, it } from 'vitest';
import { isActiveUserSocketData } from './eventRouter';

describe('isActiveUserSocketData', () => {
    it('does not treat session-scoped CLI sockets as active user presence', () => {
        expect(isActiveUserSocketData({
            clientType: 'session-scoped',
        })).toBe(false);
    });

    it('does not treat machine-scoped daemon sockets as active user presence', () => {
        expect(isActiveUserSocketData({
            clientType: 'machine-scoped',
        })).toBe(false);
    });

    it('treats an active user client as active presence', () => {
        expect(isActiveUserSocketData({
            clientType: 'user-scoped',
            appState: 'active',
        })).toBe(true);
    });

    it('does not treat a backgrounded user client as active presence', () => {
        expect(isActiveUserSocketData({
            clientType: 'user-scoped',
            appState: 'background',
        })).toBe(false);
    });

    it('keeps legacy user clients active when state is missing', () => {
        expect(isActiveUserSocketData({})).toBe(true);
    });
});
