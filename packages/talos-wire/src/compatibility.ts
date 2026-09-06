/**
 * Protocol compatibility only. These values never name the Talos product in UI.
 * Domain separation is part of the encryption format, not a branding setting.
 * Changing any context makes previously encrypted accounts/attachments unreadable.
 */
export const encryptionContexts = {
    content: 'Happy EnCoder',
    analytics: 'Happy Coder',
    blobs: 'Happy Blobs',
    serverTokens: 'happy-server-tokens',
} as const;

/** Used only when the user explicitly selects a relay that predates the identity endpoint. */
export const legacyServerBanner = 'Welcome to Happy Server!';

/** Authentication token domains are also protocol constants, including OAuth state. */
export const authenticationContexts = {
    persistent: 'handy',
    github: 'github-happy',
} as const;

/** Machine RPC names are deployed protocol identifiers, independent of product labels. */
export const rpcMethods = {
    spawnSession: 'spawn-happy-session',
    resumeSession: 'resume-happy-session',
} as const;

const metadataAliases = {
    happyCliVersion: 'talosCliVersion',
    happyHomeDir: 'talosHomeDir',
    happyLibDir: 'talosLibDir',
    happyToolsDir: 'talosToolsDir',
    requiresHappyAgentAuth: 'requiresTalosAgentAuth',
    happyAgentAuthenticated: 'talosAgentAuthenticated',
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Normalize known metadata fields only; never rewrite conversation content or paths. */
export function normalizeMetadata<T>(value: T): T {
    if (!isRecord(value)) return value;
    const result: Record<string, unknown> = { ...value };
    for (const [oldKey, key] of Object.entries(metadataAliases)) {
        if (result[key] === undefined && result[oldKey] !== undefined) result[key] = result[oldKey];
        delete result[oldKey];
    }
    if (isRecord(result.resumeSupport)) result.resumeSupport = normalizeMetadata(result.resumeSupport);
    if (result.shutdownSource === 'happy-app') result.shutdownSource = 'talos-app';
    if (result.shutdownSource === 'happy-cli') result.shutdownSource = 'talos-cli';
    return result as T;
}

/** Include wire aliases so accounts explicitly shared with an earlier client remain usable. */
export function toWireMetadata<T>(value: T): T {
    if (!isRecord(value)) return value;
    const result: Record<string, unknown> = { ...value };
    for (const [oldKey, key] of Object.entries(metadataAliases)) {
        if (result[key] !== undefined) result[oldKey] = result[key];
    }
    if (isRecord(result.resumeSupport)) result.resumeSupport = toWireMetadata(result.resumeSupport);
    if (result.shutdownSource === 'talos-app') result.shutdownSource = 'happy-app';
    if (result.shutdownSource === 'talos-cli') result.shutdownSource = 'happy-cli';
    return result as T;
}
