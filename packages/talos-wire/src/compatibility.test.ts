import { describe, expect, it } from 'vitest';
import { encryptionContexts, rpcMethods, normalizeMetadata, toWireMetadata } from './compatibility';

describe('stored account compatibility', () => {
    it('preserves deployed machine RPC identifiers for earlier clients and daemons', () => {
        expect(rpcMethods).toEqual({ spawnSession: 'spawn-happy-session', resumeSession: 'resume-happy-session' });
    });
    it('retains the deployed encryption domains exactly', () => {
        expect(encryptionContexts).toEqual({
            content: 'Happy EnCoder', analytics: 'Happy Coder',
            blobs: 'Happy Blobs', serverTokens: 'happy-server-tokens',
        });
    });

    it('reads earlier machine metadata without losing capabilities or changing paths', () => {
        const old = {
            happyCliVersion: '1.1.11', happyHomeDir: '/home/user/.happy',
            resumeSupport: { requiresHappyAgentAuth: true, happyAgentAuthenticated: true },
            shutdownSource: 'happy-app', description: 'A happy project',
        };
        expect(normalizeMetadata(old)).toEqual({
            talosCliVersion: '1.1.11', talosHomeDir: '/home/user/.happy',
            resumeSupport: { requiresTalosAgentAuth: true, talosAgentAuthenticated: true },
            shutdownSource: 'talos-app', description: 'A happy project',
        });
        expect(old.resumeSupport.happyAgentAuthenticated).toBe(true);
        expect(old).not.toHaveProperty('talosHomeDir');
    });

    it('round trips current metadata and publishes the earlier required fields', () => {
        const current = { talosCliVersion: '1.0.0', talosHomeDir: '/home/user/.talos',
            resumeSupport: { requiresTalosAgentAuth: false, talosAgentAuthenticated: true }, shutdownSource: 'talos-cli' };
        const wire = toWireMetadata(current);
        expect(wire).toMatchObject({ happyCliVersion: '1.0.0', happyHomeDir: '/home/user/.talos',
            resumeSupport: { requiresHappyAgentAuth: false, happyAgentAuthenticated: true }, shutdownSource: 'happy-cli' });
        expect(normalizeMetadata(wire)).toEqual(current);
        expect(current).not.toHaveProperty('happyHomeDir');
    });

    it('prefers current fields when mixed versions provide both', () => {
        expect(normalizeMetadata({ happyCliVersion: 'old', talosCliVersion: 'new' })).toEqual({ talosCliVersion: 'new' });
    });

    it.each([null, undefined, 0, 'happy', ['happy']])('leaves non-metadata values untouched: %j', value => {
        expect(normalizeMetadata(value)).toBe(value);
        expect(toWireMetadata(value)).toBe(value);
    });
});
