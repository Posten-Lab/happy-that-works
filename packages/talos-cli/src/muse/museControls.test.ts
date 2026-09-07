import { describe, expect, it } from 'vitest';
import { museEffortLevels, museWireEffort, parseMuseControls, museHostArgs, museTerminalArgs } from './museControls';

describe('Muse native controls', () => {
    it('supports all native effort choices and translates the max alias', () => {
        expect(museEffortLevels).toEqual(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
        for (const effort of museEffortLevels) {
            expect(parseMuseControls(['--reasoning-effort', effort]).overrides.effort).toBe(effort);
            expect(museWireEffort(effort)).toBe(effort === 'max' ? 'xhigh' : effort);
        }
        expect(() => parseMuseControls(['--reasoning-effort', 'invented'])).toThrow('Unsupported');
    });
    it.each([['untrusted', 'default'], ['on-request', 'safe-yolo'], ['never', 'never']])('maps native approval %s', (native, mode) => {
        const parsed = parseMuseControls([`--approval-mode=${native}`]);
        expect(parsed.overrides.permissionMode).toBe(mode);
        expect(museTerminalArgs({ permissionMode: mode, effort: 'high', hostArgs: [] }, [])).toContain(native);
    });
    it('distinguishes bypassing approvals from disabling the sandbox', () => {
        expect(parseMuseControls(['--disable-approval']).overrides.permissionMode).toBe('bypassPermissions');
        const state = { permissionMode: 'bypassPermissions', effort: 'high' as const, hostArgs: [] };
        expect(museHostArgs(state)).toEqual([]);
        state.permissionMode = 'yolo';
        expect(museHostArgs(state)).toEqual(['--disable-sandbox', '--trust-workspace']);
        state.permissionMode = 'default';
        expect(museHostArgs(state)).toEqual([]);
    });
    it('carries native sandbox settings across both kinds of host', () => {
        const parsed = parseMuseControls(['--reasoning-effort=ultra', '--sandbox-network', 'restricted', '--disable-shell', '--trust-workspace']);
        const state = { permissionMode: 'never', effort: 'high' as const, hostArgs: [], ...parsed.overrides };
        expect(museHostArgs(state)).toEqual(['--sandbox-network', 'restricted', '--disable-shell', '--trust-workspace']);
        expect(museTerminalArgs(state, parsed.remaining)).toEqual([...state.hostArgs, '--approval-mode', 'never', '--reasoning-effort', 'ultra']);
    });
});
