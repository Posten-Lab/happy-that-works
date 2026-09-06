import { legacyInstallation } from '@ahmadposten/talos-wire';
import { decodeBase64, encodeBase64 } from '@/encryption/base64';

// Keep installed CLI pairing links usable when the native app updates in place.
const terminalPrefixes = ['talos://terminal?', `${legacyInstallation.accountLinkPrefix.split(':')[0]}://terminal?`];

export function parseTerminalLink(url: string): Uint8Array | null {
    const prefix = terminalPrefixes.find(value => url.startsWith(value));
    if (!prefix) return null;
    const encoded = url.slice(prefix.length);
    if (!/^[A-Za-z0-9_-]{43}$/.test(encoded)) return null;
    try {
        const key = decodeBase64(encoded, 'base64url');
        return key.length === 32 && encodeBase64(key, 'base64url') === encoded ? key : null;
    } catch {
        return null;
    }
}
