import type { AuthCredentials } from '@/auth/tokenStorage';
import type { Encryption } from '../encryption/encryption';
import type { ApiMessage } from '../apiTypes';
import type { Session } from '../storageTypes';
import { normalizeRawMessage } from '../typesRaw';
import { getServerUrl } from '../serverConfig';
import { getTalosClientId } from '../apiSocket';
import { parseToken } from '@/utils/parseToken';
import { createSearchCache } from './searchCache';
import { SearchCoordinator, type SearchSessionDescriptor } from './searchCoordinator';
import { extractSearchMessages } from './searchIndex';
import { getSearchSession, SearchRequestError } from './getSearchSession';
export type { SessionSearchResult, SearchMessage } from './searchIndex';

export const sessionSearch = new SearchCoordinator();

export function configureSessionSearch(credentials: AuthCredentials, encryption: Encryption, handlers: {
    applySession(session: Omit<Session, 'presence'>): void;
    loadMessage(sessionId: string, seq: number, signal?: AbortSignal): Promise<void>;
} = { applySession: () => {}, loadMessage: async () => {} }) {
    const baseUrl = getServerUrl().replace(/\/$/, '');
    const accountController = new AbortController();
    async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        accountController.signal.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) controller.abort();
        if (accountController.signal.aborted) controller.abort();
        const timeout = setTimeout(abort, 30_000);
        try {
            const response = await fetch(`${baseUrl}${path}`, {
                signal: controller.signal,
                headers: { Authorization: `Bearer ${credentials.token}`, 'X-Talos-Client': getTalosClientId() },
            });
            if (!response.ok) throw new SearchRequestError(response.status);
            return await response.json() as T;
        } finally {
            clearTimeout(timeout);
            signal?.removeEventListener('abort', abort);
            accountController.signal.removeEventListener('abort', abort);
        }
    }

    async function sessionEncryption(descriptor: SearchSessionDescriptor) {
        let cipher = encryption.getSessionEncryption(descriptor.id);
        if (!cipher) {
            const key = descriptor.dataEncryptionKey ? await encryption.decryptEncryptionKey(descriptor.dataEncryptionKey) : null;
            if (descriptor.dataEncryptionKey && !key) throw new Error('Unable to decrypt this conversation.');
            await encryption.initializeSessions(new Map([[descriptor.id, key]]));
            cipher = encryption.getSessionEncryption(descriptor.id);
        }
        if (!cipher) throw new Error('Conversation encryption is not ready.');
        return cipher;
    }

    sessionSearch.configure({
        dispose: () => accountController.abort(),
        cache: createSearchCache(`${encodeURIComponent(baseUrl)}:${parseToken(credentials.token)}:${encryption.anonID}`),
        encrypt: value => encryption.encryptRaw({ purpose: 'talos-session-search-v1', value }),
        decrypt: async value => {
            const decrypted = await encryption.decryptRaw(value);
            return decrypted?.purpose === 'talos-session-search-v1' ? decrypted.value : null;
        },
        listSessions: (cursor, since, signal) => {
            const params = new URLSearchParams({ limit: '200' });
            if (cursor) params.set('cursor', cursor);
            if (since !== null) params.set('lastMessageSince', String(since));
            return request(`/v2/sessions?${params}`, signal);
        },
        getSession: id => getSearchSession(id, request),
        decryptSession: async descriptor => {
            const cipher = await sessionEncryption(descriptor);
            const metadata = await cipher.decryptMetadata(descriptor.metadataVersion, descriptor.metadata);
            if (!metadata) throw new Error('Some conversation titles could not be decrypted. Please retry.');
            return { id: descriptor.id, title: metadata.summary?.text ?? '', active: descriptor.active,
                createdAt: descriptor.createdAt, updatedAt: descriptor.updatedAt, lastMessageAt: descriptor.lastMessageAt };
        },
        readMessages: async (descriptor, afterSeq, signal) => {
            const cipher = await sessionEncryption(descriptor);
            const page = await request<{ messages: ApiMessage[]; hasMore: boolean }>(
                `/v3/sessions/${encodeURIComponent(descriptor.id)}/messages?after_seq=${afterSeq}&limit=200`, signal);
            // A malformed ciphertext can throw before the batch finishes. Fall
            // back per record so one unreadable row cannot hide later history.
            const decrypted = await cipher.decryptMessages(page.messages).catch(() => []);
            const messages = [];
            let failedCount = 0;
            for (let index = 0; index < page.messages.length; index++) {
                const raw = page.messages[index];
                let content = decrypted[index]?.content;
                // Failed batch results may be held in the chat decryption cache.
                // Retry raw ciphertext to let an explicit retry actually recover.
                if (!content && raw.content.t === 'encrypted') content = await cipher.decryptRaw(raw.content.c).catch(() => null);
                if (!content) { failedCount++; continue; }
                const normalized = normalizeRawMessage(raw.id, raw.localId ?? null, raw.createdAt, content);
                if (normalized) messages.push(...extractSearchMessages(normalized, raw.seq));
            }
            return { messages, failedCount, lastSeq: Math.max(afterSeq, ...page.messages.map(message => message.seq)), hasMore: page.hasMore };
        },
        openSession: async (descriptor, seq) => {
            // Check existence and refresh metadata before showing a cached result.
            const fresh = await getSearchSession(descriptor.id, request);
            const cipher = await sessionEncryption(fresh);
            const metadata = await cipher.decryptMetadata(fresh.metadataVersion, fresh.metadata);
            const agentState = await cipher.decryptAgentState(fresh.agentStateVersion, fresh.agentState);
            if (accountController.signal.aborted) throw new Error('Search account disconnected.');
            handlers.applySession({ ...fresh, metadata, agentState, thinking: false, thinkingAt: 0 });
            if (seq !== undefined) await handlers.loadMessage(fresh.id, seq, accountController.signal);
        },
    });
}
