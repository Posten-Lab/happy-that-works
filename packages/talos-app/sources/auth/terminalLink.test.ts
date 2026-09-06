import { describe, expect, it } from 'vitest';
import { parseTerminalLink } from './terminalLink';
import { encodeBase64 } from '@/encryption/base64';

describe('installed terminal pairing compatibility', () => {
    const key = Uint8Array.from({ length: 32 }, (_, index) => index);
    const encoded = encodeBase64(key, 'base64url');

    it('opens both new and already-issued CLI pairing links', () => {
        expect(parseTerminalLink(`talos://terminal?${encoded}`)).toEqual(key);
        expect(parseTerminalLink(`happy://terminal?${encoded}`)).toEqual(key);
    });

    it('rejects malformed keys, other routes, and URL suffixes for both schemes', () => {
        for (const scheme of ['talos', 'happy']) {
            for (const url of [
                `${scheme}://terminal?${encoded}#fragment`, `${scheme}://terminal?${encoded}&other=1`,
                `${scheme}://terminal?${encoded}=`, `${scheme}://terminal?${encoded.slice(1)}`,
                `${scheme}://terminal?${'A'.repeat(42)}B`, `${scheme}:///account?${encoded}`,
                `https://example.test/${scheme}://terminal?${encoded}`,
            ]) expect(parseTerminalLink(url)).toBeNull();
        }
    });
});
