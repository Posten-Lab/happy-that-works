import { normalizeMetadata } from '@ahmadposten/talos-wire';
import axios, { AxiosError } from 'axios';
import tweetnacl from 'tweetnacl';
import { z } from 'zod';

import { decodeBase64, decryptLegacy, decryptWithDataKey } from '@/api/encryption';
import type { Metadata } from '@/api/types';
import { configuration } from '@/configuration';
import { readCredentials } from '@/persistence';
import { readImportedSessionKeys } from './importedSessionKeys';
import {
    getLocalTalosAgentCredentialPath,
    readLocalTalosAgentCredentials,
    type LocalTalosAgentCredentials,
} from './localTalosAgentAuth';

const ResumableMetadataSchema = z.object({
    path: z.string().min(1),
    flavor: z.string().optional(),
    claudeSessionId: z.string().optional(),
    codexThreadId: z.string().optional(),
    museSessionId: z.string().optional(),
}).passthrough();

type RawSession = {
    id: string;
    active: boolean;
    metadata: string;
    metadataVersion: number;
    agentState: string | null;
    agentStateVersion: number;
    seq: number;
    dataEncryptionKey: string | null;
};

type RecordEncryption = {
    key: Uint8Array;
    variant: 'legacy' | 'dataKey';
};

export type ResumableTalosSession = {
    id: string;
    active: boolean;
    metadata: Metadata;
};

export type ReconnectableTalosSession = ResumableTalosSession & {
    seq: number;
    metadataVersion: number;
    agentStateVersion: number;
    encryptionKey: Uint8Array;
    encryptionVariant: 'legacy' | 'dataKey';
};

export function resolveSessionRecordByPrefix<T extends { id: string }>(records: T[], sessionId: string): T {
    const trimmed = sessionId.trim();
    if (!trimmed) {
        throw new Error('Talos session ID is required: talos resume <session-id>');
    }

    const matches = records.filter((record) => record.id.startsWith(trimmed));
    if (matches.length === 0) {
        throw new Error(`No Talos session found matching "${trimmed}"`);
    }
    if (matches.length > 1) {
        throw new Error(`Ambiguous Talos session "${trimmed}" matches ${matches.length} sessions. Be more specific.`);
    }
    return matches[0];
}

function decryptBoxBundle(bundle: Uint8Array, recipientSecretKey: Uint8Array): Uint8Array | null {
    if (bundle.length < 56) {
        return null;
    }

    const ephemeralPublicKey = bundle.slice(0, 32);
    const nonce = bundle.slice(32, 56);
    const ciphertext = bundle.slice(56);
    const decrypted = tweetnacl.box.open(ciphertext, nonce, ephemeralPublicKey, recipientSecretKey);

    return decrypted ? new Uint8Array(decrypted) : null;
}

function readAgentCredentials() {
    const credentialPath = getLocalTalosAgentCredentialPath();
    const credentials = readLocalTalosAgentCredentials();
    if (!credentials) {
        throw new Error(
            `Cannot resume historical Talos sessions without ${credentialPath}. Run \`talos-agent auth login\` in this environment first.`,
        );
    }
    return credentials;
}

function resolveSessionEncryption(session: RawSession, credentials: LocalTalosAgentCredentials): RecordEncryption {
    if (session.dataEncryptionKey) {
        const encrypted = decodeBase64(session.dataEncryptionKey);
        const sessionKey = decryptBoxBundle(encrypted.slice(1), credentials.contentKeyPair.secretKey);
        if (!sessionKey) {
            throw new Error(`Failed to decrypt data key for Talos session ${session.id}`);
        }
        return {
            key: sessionKey,
            variant: 'dataKey',
        };
    }

    return {
        key: credentials.secret,
        variant: 'legacy',
    };
}

function decryptSessionMetadata(session: RawSession, encryption: RecordEncryption): Metadata {
    const encryptedMetadata = decodeBase64(session.metadata);
    const metadata = encryption.variant === 'dataKey'
        ? decryptWithDataKey(encryptedMetadata, encryption.key)
        : decryptLegacy(encryptedMetadata, encryption.key);

    if (!metadata) {
        throw new Error(`Failed to decrypt metadata for Talos session ${session.id}`);
    }

    try {
        return ResumableMetadataSchema.parse(normalizeMetadata(metadata)) as Metadata;
    } catch {
        throw new Error(`Talos session ${session.id} is missing resumable metadata.`);
    }
}

async function fetchSessions(credentials: { token: string }): Promise<RawSession[]> {
    try {
        const response = await axios.get(`${configuration.serverUrl}/v1/sessions`, {
            headers: {
                Authorization: `Bearer ${credentials.token}`,
                'X-Talos-Client': `cli-coding-session/${configuration.currentCliVersion}`,
            },
            timeout: 10_000,
        });
        return (response.data as { sessions: RawSession[] }).sessions;
    } catch (error) {
        if (error instanceof AxiosError) {
            if (error.response?.status === 401) {
                throw new Error('Talos session lookup authentication expired. Run `talos-agent auth login` in this environment.');
            }
            throw new Error(`Failed to load Talos sessions: ${error.message}`);
        }
        throw error;
    }
}

async function resolveEncryptedSession(sessionId: string): Promise<{ matched: RawSession; encryption: RecordEncryption }> {
    const agent = readLocalTalosAgentCredentials();
    if (agent) {
        const matched = resolveSessionRecordByPrefix(await fetchSessions(agent), sessionId);
        return { matched, encryption: resolveSessionEncryption(matched, agent) };
    }
    const credentials = await readCredentials();
    if (!credentials) { readAgentCredentials(); throw new Error('Talos account credentials are unavailable.'); }
    // Resolve against the authenticated account first. An archive alone cannot make a foreign session accessible.
    const matched = resolveSessionRecordByPrefix(await fetchSessions(credentials), sessionId);
    const archive = await readImportedSessionKeys(configuration.talosHomeDir, credentials);
    const key = archive && Object.hasOwn(archive.sessions, matched.id) ? archive.sessions[matched.id] : undefined;
    if (!key) {
        throw new Error('No imported key is available for this session. Run `talos migrate --import-session-keys` or `talos-agent auth login`.');
    }
    const expectedVariant = matched.dataEncryptionKey ? 'dataKey' : 'legacy';
    if (key.encryptionVariant !== expectedVariant) throw new Error('The imported key does not match this session encryption format.');
    return { matched, encryption: { key: decodeBase64(key.encryptionKey), variant: key.encryptionVariant } };
}

export async function resolveTalosSession(sessionId: string): Promise<ResumableTalosSession> {
    const { matched, encryption } = await resolveEncryptedSession(sessionId);
    return {
        id: matched.id,
        active: matched.active,
        metadata: decryptSessionMetadata(matched, encryption),
    };
}

export async function resolveReconnectableSession(sessionId: string): Promise<ReconnectableTalosSession> {
    const { matched, encryption } = await resolveEncryptedSession(sessionId);
    return {
        id: matched.id,
        active: matched.active,
        metadata: decryptSessionMetadata(matched, encryption),
        seq: matched.seq,
        metadataVersion: matched.metadataVersion,
        agentStateVersion: matched.agentStateVersion,
        encryptionKey: encryption.key,
        encryptionVariant: encryption.variant,
    };
}
