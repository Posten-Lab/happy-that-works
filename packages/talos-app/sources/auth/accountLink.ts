import { legacyInstallation } from '@ahmadposten/talos-wire';
import { decodeBase64, encodeBase64 } from '@/encryption/base64';

const accountLinkPrefix = 'talos:///account?';

/** Existing installations are selected explicitly; every new QR defaults to Talos. */
export function buildAccountLink(publicKey: Uint8Array, existingInstallation = false): string {
    if (publicKey.length !== 32) throw new Error('An account link requires a 32-byte public key.');
    const prefix = existingInstallation ? legacyInstallation.accountLinkPrefix : accountLinkPrefix;
    return prefix + encodeBase64(publicKey, 'base64url');
}

/** Accept only an exact supported route and a canonical, unpadded public key. */
export function parseAccountLink(url: string): Uint8Array | null {
    const prefix = [accountLinkPrefix, legacyInstallation.accountLinkPrefix].find(value => url.startsWith(value));
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
