import { randomUUID } from 'node:crypto';
import { ApiClient } from '@/api/api';
import type { ApiSessionClient, ACPMessageData } from '@/api/apiSession';
import type { Metadata, Session } from '@/api/types';
import { type Credentials, readSettings } from '@/persistence';
import { initialMachineMetadata } from '@/daemon/run';
import { notifyDaemonSessionStarted } from '@/daemon/controlClient';
import { encodeBase64, decodeBase64 } from '@/api/encryption';
import { createSessionMetadata, type BackendFlavor } from '@/utils/createSessionMetadata';
import { setupOfflineReconnection } from '@/utils/setupOfflineReconnection';
import { BasePermissionHandler, type PermissionResult } from '@/utils/BasePermissionHandler';
import { MessageQueue2 } from '@/utils/MessageQueue2';
import { hashObject } from '@/utils/deterministicJson';
import { registerKillSessionHandler } from '@/claude/registerKillSessionHandler';
import { logger } from '@/ui/logger';

export type ProviderPromptOptions = { model?: string | null; permissionMode?: string; effort?: string };
export interface ManagedProviderCallbacks {
    message(message: { id: string; user?: string; data?: ACPMessageData }): void;
    metadata(metadata: Partial<Metadata>): void;
    mode(mode: 'local' | 'remote'): void;
    activity(thinking: boolean): void;
    notice(message: string): void;
    permission(id: string, tool: string, input: unknown): Promise<PermissionResult>;
    cancelPermission?(id: string): void;
    exited(error?: Error): void;
}
export interface ManagedProvider {
    start(resumeId?: string, mode?: 'local' | 'remote'): Promise<void>;
    prompt(prompt: string, options: ProviderPromptOptions): Promise<void>;
    switchMode(mode: 'local' | 'remote'): Promise<void>;
    cancel(): Promise<void>;
    dispose(): Promise<void>;
}

class ProviderPermissions extends BasePermissionHandler {
    protected getLogPrefix() { return '[Provider]'; }
    cancel(id: string) {
        const request = this.pendingRequests.get(id);
        if (!request) return;
        this.pendingRequests.delete(id);
        request.resolve({ decision: 'abort' });
        this.session.updateAgentState(current => {
            const { [id]: removed, ...requests } = current.requests ?? {};
            return { ...current, requests, completedRequests: { ...current.completedRequests, ...(removed ? {
                [id]: { ...removed, status: 'canceled' as const, completedAt: Date.now() },
            } : {}) } };
        });
    }
    request(id: string, toolName: string, input: unknown): Promise<PermissionResult> {
        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject, toolName, input });
            this.addPendingRequestToState(id, toolName, input);
        });
    }
}

/** Shared Talos lifecycle for native providers: encrypted sessions, RPCs and permissions. */
export async function runManagedProvider(opts: {
    credentials: Credentials;
    flavor: BackendFlavor & Parameters<ApiSessionClient['sendAgentMessage']>[0];
    startedBy?: 'daemon' | 'terminal';
    startingMode: 'local' | 'remote';
    resumeId?: string;
    create(callbacks: ManagedProviderCallbacks, sessionId: string): ManagedProvider;
}): Promise<void> {
    const api = await ApiClient.create(opts.credentials);
    const settings = await readSettings();
    if (!settings.machineId) throw new Error('No machine identity; run talos auth');
    await api.getOrCreateMachine({ machineId: settings.machineId, metadata: initialMachineMetadata });
    const { metadata, state } = createSessionMetadata({ flavor: opts.flavor, machineId: settings.machineId, startedBy: opts.startedBy });
    const tag = randomUUID();
    const env = process.env;
    let response: Session | null;
    if (env.TALOS_RECONNECT_SESSION_ID && env.TALOS_RECONNECT_ENCRYPTION_KEY && env.TALOS_RECONNECT_ENCRYPTION_VARIANT) {
        if (!['legacy', 'dataKey'].includes(env.TALOS_RECONNECT_ENCRYPTION_VARIANT)) throw new Error('Invalid reconnect encryption variant');
        response = { id: env.TALOS_RECONNECT_SESSION_ID, encryptionKey: decodeBase64(env.TALOS_RECONNECT_ENCRYPTION_KEY),
            encryptionVariant: env.TALOS_RECONNECT_ENCRYPTION_VARIANT as 'legacy' | 'dataKey',
            seq: Number(env.TALOS_RECONNECT_SEQ || 0), metadata, agentState: state,
            metadataVersion: Number(env.TALOS_RECONNECT_METADATA_VERSION || 0), agentStateVersion: Number(env.TALOS_RECONNECT_AGENT_STATE_VERSION || 0) };
    } else response = await api.getOrCreateSession({ tag, metadata, state });

    let session: ApiSessionClient;
    let permissions: ProviderPermissions;
    let driver: ManagedProvider;
    let mode = opts.startingMode;
    let thinking = false;
    let ending = false;
    let failure: Error | undefined;
    let latestMetadata: Partial<Metadata> = {};
    const bufferedMessages: Parameters<ManagedProviderCallbacks['message']>[0][] = [];
    let offline = !response;
    const queue = new MessageQueue2<ProviderPromptOptions>(hashObject);
    const reconnect = setupOfflineReconnection({ api, sessionTag: tag, metadata, state, response,
        onSessionSwap(next) {
            session = next;
            offline = false;
            for (const message of bufferedMessages.splice(0)) forwardMessage(message);
            permissions.updateSession(next);
            bind();
            session.updateMetadata(current => ({ ...current, ...latestMetadata }));
        } });
    session = reconnect.session;
    permissions = new ProviderPermissions(session);
    permissions.reset('Previous provider process exited');
    if (response) {
        await notifyDaemonSessionStarted(response.id, metadata, { encryptionKey: encodeBase64(response.encryptionKey),
            encryptionVariant: response.encryptionVariant, seq: response.seq,
            metadataVersion: response.metadataVersion, agentStateVersion: response.agentStateVersion }).catch(error => logger.debug('[Provider] Daemon notification failed', error));
        console.log(`Talos session: ${response.id}`);
    }
    function forwardMessage(message: Parameters<ManagedProviderCallbacks['message']>[0]) {
        if (offline) { bufferedMessages.push(message); return; }
        if (message.user !== undefined) session.sendProviderUserMessage(message.user, message.id);
        if (message.data) session.sendAgentMessage(opts.flavor, message.data, message.id);
    }
    driver = opts.create({
        message: forwardMessage,
        metadata(update) {
            latestMetadata = { ...latestMetadata, ...update };
            session.updateMetadata(current => ({ ...current, ...update }));
        },
        mode(next) {
            mode = next;
            session.updateAgentState(current => ({ ...current, controlledByUser: next === 'local' }));
            session.sendSessionEvent({ type: 'switch', mode: next });
            session.keepAlive(thinking, mode);
        },
        activity(active) {
            if (thinking !== active) session.sendAgentMessage(opts.flavor, { type: active ? 'task_started' : 'task_complete', id: randomUUID() });
            thinking = active; session.keepAlive(active, mode);
        },
        notice(message) { session.sendSessionEvent({ type: 'message', message }); logger.debug(`[${opts.flavor}] ${message}`); },
        permission: (id, tool, input) => permissions.request(id, tool, input),
        cancelPermission: id => permissions.cancel(id),
        exited(error) { failure = error; ending = true; queue.close(); },
    }, session.sessionId);
    function bind() {
        session.onFileEvent(message => {
            session.sendFileStatus(message.content.data.ev.ref, 'rejected', 'unsupported');
            session.sendSessionEvent({ type: 'message', message: 'This provider currently accepts text prompts. Open files from the native CLI workspace.' });
        });
        session.onUserMessage(message => {
            if (!message.content.text) return;
            queue.push(message.content.text, { model: message.meta?.model, permissionMode: message.meta?.permissionMode,
                effort: message.meta?.effort ?? undefined });
        });
        session.rpcHandlerManager.registerHandler('abort', async () => { permissions.abortAll(); await driver.cancel(); });
        session.rpcHandlerManager.registerHandler<{ to: 'local' | 'remote' }, boolean>('switch', async ({ to }) => {
            if (to !== 'local' && to !== 'remote') throw new Error('Unknown control mode');
            await driver.switchMode(to);
            permissions.abortAll();
            return true;
        });
        registerKillSessionHandler(session.rpcHandlerManager, async () => { ending = true; queue.close(); permissions.abortAll(); await driver.dispose(); });
    }
    bind();
    const heartbeat = setInterval(() => session.keepAlive(thinking, mode), 2000);
    const stop = () => { ending = true; queue.close(); permissions.abortAll(); void driver.dispose(); };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
    try {
        await driver.start(opts.resumeId, opts.startingMode);
        while (!ending) {
            const batch = await queue.waitForMessagesAndGetAsString(new AbortController().signal);
            if (!batch || ending) break;
            try { await driver.prompt(batch.message, batch.mode); }
            catch (error) { session.sendSessionEvent({ type: 'message', message: String(error) }); }
            finally { thinking = false; session.keepAlive(false, mode); session.sendSessionEvent({ type: 'ready' }); }
        }
        if (failure) throw failure;
    } finally {
        clearInterval(heartbeat);
        process.off('SIGTERM', stop);
        process.off('SIGINT', stop);
        reconnect.reconnectionHandle?.cancel();
        permissions.abortAll();
        await driver.dispose();
        session.updateMetadata(current => ({ ...current, lifecycleState: 'archived', lifecycleStateSince: Date.now(), archivedBy: 'cli', archiveReason: 'Session ended' }));
        session.sendSessionDeath();
        await session.flush();
        await session.close();
    }
}
