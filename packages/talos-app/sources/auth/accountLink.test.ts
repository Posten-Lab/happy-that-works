import { describe, expect, it } from 'vitest';
import { buildAccountLink, parseAccountLink } from './accountLink';
import { decodeBase64, encodeBase64 } from '@/encryption/base64';

const key = Uint8Array.from({ length: 32 }, (_, index) => index);

describe('account linking between installations', () => {
    it('defaults to the Talos scheme and round trips the public key', () => {
        const link = buildAccountLink(key);
        expect(link).toBe(`talos:///account?${encodeBase64(key, 'base64url')}`);
        expect(parseAccountLink(link)).toEqual(key);
    });

    it('emits a QR accepted by the already-installed client only when selected', () => {
        const deployedClientPattern = /^happy:\/\/\/account\?([A-Za-z0-9_-]{43})$/;
        expect(buildAccountLink(key)).not.toMatch(deployedClientPattern);
        const link = buildAccountLink(key, true);
        const match = deployedClientPattern.exec(link);
        expect(match).not.toBeNull();
        // The deployed scanner checks this prefix then decodes the remaining key.
        expect(link.startsWith('happy:///account?')).toBe(true);
        expect(decodeBase64(match![1], 'base64url')).toEqual(key);
        expect(parseAccountLink(link)).toEqual(key);
    });

    it('rejects other routes, malformed keys and additional URL components', () => {
        const encoded = encodeBase64(key, 'base64url');
        for (const url of [
            '', `https://talosapp.ai/account?${encoded}`, `talos://account?${encoded}`,
            `talos:///terminal?${encoded}`, `other:///account?${encoded}`,
            `talos:///account?${encoded}=`, `talos:///account?${encoded.slice(1)}`,
            `talos:///account?${encoded}x`, `talos:///account?${encoded}&extra=1`,
            `talos:///account?${encoded}#fragment`, `talos:///account?%41${encoded.slice(1)}`,
            ` talos:///account?${encoded}`, `happy:///account?${encoded}=`,
            'talos:///account?' + 'A'.repeat(42) + 'B', // Nonzero unused base64 bits.
        ]) expect(parseAccountLink(url)).toBeNull();
        expect(() => buildAccountLink(new Uint8Array(31))).toThrow('32-byte');
        expect(() => buildAccountLink(new Uint8Array(33))).toThrow('32-byte');
    });
});
