import { normalizeMetadata } from '@talos/wire';
import axios, { AxiosError } from 'axios';
import tweetnacl from 'tweetnacl';
import { z } from 'zod';

import { decodeBase64, decryptLegacy, decryptWithDataKey } from '@/api/encryption';
import type { Metadata } from '@/api/types';
import { configuration } from '@/configuration';
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

function decryptSessionMetadata(session: RawSession, credentials: LocalTalosAgentCredentials): Metadata {
    const encryption = resolveSessionEncryption(session, credentials);
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

async function fetchSessions(credentials: LocalTalosAgentCredentials): Promise<RawSession[]> {
    try {
        const response = await axios.get(`${configuration.serverUrl}/v1/sessions`, {
            headers: {
                Authorization: `Bearer ${credentials.token}`,
                'X-Talos-Client': `cli-coding-session/${configuration.currentCliVersion}`,
            },
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

export async function resolveTalosSession(sessionId: string): Promise<ResumableTalosSession> {
    const credentials = readAgentCredentials();
    const sessions = await fetchSessions(credentials);
    const matched = resolveSessionRecordByPrefix(sessions, sessionId);
    return {
        id: matched.id,
        active: matched.active,
        metadata: decryptSessionMetadata(matched, credentials),
    };
}

export async function resolveReconnectableSession(sessionId: string): Promise<ReconnectableTalosSession> {
    const credentials = readAgentCredentials();
    const sessions = await fetchSessions(credentials);
    const matched = resolveSessionRecordByPrefix(sessions, sessionId);
    const encryption = resolveSessionEncryption(matched, credentials);
    return {
        id: matched.id,
        active: matched.active,
        metadata: decryptSessionMetadata(matched, credentials),
        seq: matched.seq,
        metadataVersion: matched.metadataVersion,
        agentStateVersion: matched.agentStateVersion,
        encryptionKey: encryption.key,
        encryptionVariant: encryption.variant,
    };
}
