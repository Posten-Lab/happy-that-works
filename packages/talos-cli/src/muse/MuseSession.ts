import { realpathSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import type { SpawnedMspConnection } from '@muse-code/sdk';
import type { PermissionResult } from '@/utils/BasePermissionHandler';
import { connectMuse, museExecutable } from './museClient';
import { approvalChoice, MuseMessageMapper, musePermissionModes, object, text, type JsonObject, type MuseMessage } from './museProtocol';

export interface MuseSessionCallbacks {
    message(message: MuseMessage): void;
    metadata(metadata: JsonObject): void;
    mode(mode: 'local' | 'remote'): void;
    activity(thinking: boolean): void;
    notice(message: string): void;
    permission(id: string, tool: string, input: unknown): Promise<PermissionResult>;
    cancelPermission?(id: string): void;
    exited(error?: Error): void;
}

/** Owns only the native process/protocol boundary. Talos owns transport and UI. */
export class MuseSession {
    private host: SpawnedMspConnection | null = null;
    private native: ChildProcess | null = null;
    private nativeExit: Promise<void> | null = null;
    private mapper = new MuseMessageMapper();
    private poll: ReturnType<typeof setInterval> | undefined;
    private reading = false;
    private disposed = false;
    private disposal: Promise<void> | undefined;
    private permissionMode = 'default';
    private questions = new Set<string>();
    private transitioning = false;
    private operations: Promise<unknown> = Promise.resolve();
    private turn: { id?: string; resolve(): void; reject(error: Error): void } | null = null;
    private approvals = new Map<string, string>();
    private approvalRequests = new Map<string, JsonObject>();
    private models: JsonObject[] = [];
    sessionId = '';
    mode: 'local' | 'remote' = 'remote';

    constructor(private readonly cwd: string, private readonly callbacks: MuseSessionCallbacks,
        private readonly nativeArgs: string[] = [],
        private readonly submissions?: { load(): string[]; record(commandId: string): void }) {
        for (const id of submissions?.load() ?? []) this.mapper.submitted(id);
    }

    private serialize<T>(action: () => Promise<T>): Promise<T> {
        const result = this.operations.then(action);
        this.operations = result.catch(() => {});
        return result;
    }

    private async connect() {
        const host = await connectMuse(this.cwd, (method, params) => this.notification(method, params));
        this.host = host;
        void host.exited.then(exit => {
            if (this.host !== host || this.disposed) return;
            this.host = null;
            const error = new Error(`Muse host exited (${exit.code ?? exit.signal})`);
            this.finishTurn(error);
            this.callbacks.exited(error);
        });
        return host;
    }

    private async closeHost() {
        const host = this.host;
        this.host = null;
        if (host) await host.close();
    }

    async start(resumeId?: string, mode: 'local' | 'remote' = 'remote') {
        this.sessionId = resumeId ?? '';
        const host = await this.connect();
        const result = resumeId
            ? await this.resumeHost(host, resumeId)
            : await host.connection.command('session/start', { workspaceRoot: this.cwd });
        const session = object(result.session);
        this.sessionId = text(session.sessionId);
        if (!this.sessionId) throw new Error('Muse returned no session identity');
        if (text(session.workspaceRoot) && realpathSync(text(session.workspaceRoot)) !== realpathSync(this.cwd)) {
            throw new Error(`Muse session belongs to ${text(session.workspaceRoot)}. Run Talos from that workspace.`);
        }
        this.permissionMode = musePermissionModes.find(m => m.native === object(session.approvalMode).mode)?.id ?? 'default';
        this.callbacks.metadata({ museSessionId: this.sessionId });
        await this.history(result);
        await this.refreshModels();
        if (mode === 'local') await this.switchMode('local');
        else this.callbacks.mode('remote');
    }

    private async resumeHost(host: SpawnedMspConnection, sessionId: string) {
        // Muse 1.0.3 may stamp its startup model into the resume record. Read the
        // durable selection first so resuming cannot silently change the route.
        const stored = object((await host.connection.request('session/read', { sessionId, excludeItems: true })).session);
        const result = await host.connection.command('session/resume', { sessionId, history: 'inline' });
        const resumed = object(result.session);
        const modelId = text(stored.modelId);
        if (modelId && (modelId !== resumed.modelId || stored.providerId !== resumed.providerId)) {
            const catalog = await host.connection.request('model/list', { sessionId });
            const selected = (Array.isArray(catalog.models) ? catalog.models : []).map(object)
                .find(m => m.modelId === modelId && (!stored.providerId || m.providerId === stored.providerId));
            if (!selected) throw new Error(`Muse cannot restore the previous model ${modelId}; refusing to use a different model`);
            await host.connection.command('session/setModel', { sessionId, model: {
                modelId, providerId: selected.providerId, profileId: selected.profileId ?? null,
            } });
        }
        return result;
    }

    private async history(response: JsonObject) {
        const history = object(response.history);
        const snapshot = object(history.snapshot);
        const items = Array.isArray(history.items) ? history.items : object(snapshot.state).items;
        if (Array.isArray(items)) {
            for (const item of items) this.item(item);
            if (this.mode === 'local') this.callbacks.activity(Boolean(object(snapshot.state).activeTurn));
            return;
        }
        if (!history.mode || !this.host) return;
        let cursor: string | undefined;
        do {
            const page = await this.host.connection.request('view/page', { sessionId: this.sessionId, limit: 1000, ...(cursor ? { cursor } : {}) });
            for (const event of Array.isArray(page.events) ? page.events.map(object) : []) {
                if (text(event.method).startsWith('item/')) this.item(object(event.params).item);
            }
            const next = text(page.nextCursor);
            if (next && next === cursor) throw new Error('Muse history cursor did not advance');
            cursor = next || undefined;
        } while (cursor && !this.disposed);
    }

    private item(item: unknown) {
        for (const message of this.mapper.map(item)) this.callbacks.message(message);
    }

    private notification(method: string, params: JsonObject) {
        if (text(params.sessionId) && text(params.sessionId) !== this.sessionId) return;
        if (method === 'item/started' || method === 'item/updated' || method === 'item/completed') this.item(params.item);
        if (method === 'turn/started') {
            if (this.turn) this.turn.id = text(params.turnId);
            this.callbacks.activity(true);
        }
        if (method === 'turn/completed' || method === 'turn/unqueued') {
            if (this.turn?.id && this.turn.id !== text(params.turnId)) return;
            this.callbacks.activity(false);
            this.finishTurn(params.terminal === 'failed' ? new Error(text(object(params.error).message) || text(params.reason) || 'Muse turn failed') : undefined);
        }
        if (method === 'approval/requested' || method === 'approval/updated') {
            const id = text(params.approvalId);
            const request = { ...this.approvalRequests.get(id), ...params };
            this.approvalRequests.set(id, request);
            void this.approve(request);
        }
        if (method === 'approval/resolved') {
            const id = text(params.approvalId);
            const key = this.approvals.get(id);
            this.approvals.delete(id);
            this.approvalRequests.delete(id);
            if (key) this.callbacks.cancelPermission?.(key);
        }
        if (method === 'userInput/requested') void this.answerQuestions(params);
        if (method === 'userInput/settled') {
            const id = text(params.userInputId);
            this.questions.delete(id);
            this.callbacks.cancelPermission?.(id);
        }
        if (method === 'session/modelChanged') void this.refreshModels().catch(error => this.callbacks.notice(String(error)));
    }

    private async approve(params: JsonObject) {
        if (this.mode !== 'remote' || !this.host) return;
        const approvalId = text(params.approvalId);
        const requirement = object(params.currentRequirementId);
        const key = `${approvalId}:${requirement.sourceIndex}`;
        if (!approvalId || this.approvals.get(approvalId) === key) return;
        const previous = this.approvals.get(approvalId);
        this.approvals.set(approvalId, key);
        if (previous) this.callbacks.cancelPermission?.(previous);
        try {
            const decision = await this.callbacks.permission(key, text(params.toolName) || 'Muse action', {
                ...object(params.subject), arguments: params.rawArgs,
            });
            if (this.approvals.get(approvalId) !== key || this.mode !== 'remote') return;
            const choiceId = approvalChoice(params, decision.decision);
            if (!choiceId) throw new Error('Muse does not offer that approval choice');
            await this.host?.connection.command('approval/decide', { sessionId: this.sessionId, approvalId,
                requirementId: requirement, choiceId });
        } catch (error) { this.callbacks.notice(`Muse approval was not applied: ${String(error)}`); }
    }

    private async answerQuestions(params: JsonObject) {
        const id = text(params.userInputId);
        if (this.disposed || !id || this.mode !== 'remote' || !this.host || this.questions.has(id)) return;
        this.questions.add(id);
        const questions = (Array.isArray(params.questions) ? params.questions : []).map(object);
        const input = { questions: questions.map(q => ({ ...q, allowFreeText: true, multiSelect: object(q.selection).mode === 'multiple' })) };
        this.callbacks.message({ id: `muse:${id}:question`, data: { type: 'tool-call', callId: id, id, name: 'AskUserQuestion', input } });
        try {
            const response = await this.callbacks.permission(id, 'AskUserQuestion', input);
            if (!this.questions.has(id) || this.mode !== 'remote' || !this.host) return;
            if (response.decision !== 'approved') {
                await this.host.connection.command('userInput/cancel', { sessionId: this.sessionId, userInputId: id });
            } else {
                const values = object(object(response.updatedInput).answers);
                const selections = object(object(response.updatedInput).selectedLabels);
                const answers = questions.map(q => {
                    const value = text(values[text(q.question)]);
                    const labels = (Array.isArray(q.options) ? q.options : []).map(o => text(object(o).label));
                    if (selections[text(q.question)] === null) return { questionId: q.id, freeText: value };
                    if (object(q.selection).mode === 'multiple') {
                        const selected = selections[text(q.question)];
                        if (!Array.isArray(selected) || selected.some(v => !labels.includes(String(v)))) throw new Error('Invalid multiple-choice answer');
                        return { questionId: q.id, selectedLabels: selected };
                    }
                    return { questionId: q.id, ...(labels.includes(value) ? { selectedLabel: value } : { freeText: value }) };
                });
                await this.host.connection.command('userInput/answer', { sessionId: this.sessionId, userInputId: id, answers });
            }
            this.callbacks.message({ id: `muse:${id}:answer`, data: { type: 'tool-result', callId: id, id, output: 'Question answered' } });
        } catch (error) {
            this.callbacks.notice(`Muse answer was not applied: ${String(error)}`);
            this.questions.delete(id);
            // Keep a rejected answer actionable instead of leaving a pending turn stuck.
            if (!this.disposed && this.mode === 'remote' && this.host) void this.answerQuestions(params);
        }
    }

    async refreshModels() {
        if (!this.host) return;
        const result = await this.host.connection.request('model/list', this.mode === 'remote' ? { sessionId: this.sessionId } : {});
        const models = (Array.isArray(result.models) ? result.models : []).map(object);
        this.models = models;
        this.callbacks.metadata({ models: models.map(m => ({ code: text(m.modelId), value: text(m.displayLabel) || text(m.modelId) })),
            currentModelCode: text(models.find(m => m.isActive)?.modelId),
            operatingModes: musePermissionModes.map(m => ({ code: m.id, value: m.name })), currentOperatingModeCode: this.permissionMode });
    }

    switchMode(mode: 'local' | 'remote'): Promise<void> {
        return this.serialize(async () => {
            if (this.disposed || mode === this.mode) return;
            if (mode === 'local' && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new Error('Local control needs a terminal. Run talos muse --resume with this Muse session ID on the same machine.');
            if (mode === 'local' && this.turn) throw new Error('Stop the active turn before switching to the Muse terminal');
            this.transitioning = true;
            try {
                clearInterval(this.poll);
                if (mode === 'local') {
                    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Local control needs a terminal. Run talos muse --resume with this Muse session ID on the same machine.');
                    if (this.turn) throw new Error('Stop the active turn before switching to the Muse terminal');
                    await this.closeHost(); // Release the lease before the native CLI resumes it.
                    const child = spawn(museExecutable(), ['resume', this.sessionId, '--workspace', this.cwd, ...this.nativeArgs], { cwd: this.cwd, stdio: 'inherit' });
                    this.native = child;
                    this.nativeExit = new Promise<void>((resolve, reject) => {
                        child.once('error', reject);
                        child.once('exit', (code, signal) => {
                            if (code && this.native === child && !this.disposed) reject(new Error(`Muse terminal exited with code ${code}`));
                            else resolve();
                        });
                    });
                    void this.nativeExit.then(() => {
                        if (!this.transitioning && !this.disposed) this.callbacks.exited();
                    }, error => this.callbacks.exited(error));
                    this.mode = 'local';
                    await this.connect(); // Observer only: session/read never acquires a writer lease.
                    if (child.exitCode !== null || child.signalCode !== null) {
                        throw new Error(`Muse terminal exited during startup (${child.exitCode ?? child.signalCode})`);
                    }
                    this.poll = setInterval(() => void this.readLocal(), 1000);
                } else {
                    await this.stopNative();
                    await this.readLocal();
                    await this.closeHost();
                    const host = await this.connect();
                    const result = await this.resumeHost(host, this.sessionId);
                    await this.history(result);
                    this.mode = 'remote';
                    await this.refreshModels();
                }
                this.callbacks.mode(this.mode);
            } catch (error) {
                this.callbacks.exited(error instanceof Error ? error : new Error(String(error)));
                throw error;
            } finally { this.transitioning = false; }
        });
    }

    private async readLocal() {
        if (this.reading || !this.host || !this.sessionId) return;
        this.reading = true;
        try {
            const result = await this.host.connection.request('session/read', { sessionId: this.sessionId, excludeItems: false });
            await this.history(result);

        } catch (error) { this.callbacks.notice(`Muse terminal history unavailable: ${String(error)}`); }
        finally { this.reading = false; }
    }

    private async stopNative() {
        const child = this.native;
        if (!child) return;
        this.native = null;
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
        try { await this.nativeExit; } finally { clearTimeout(timer); this.nativeExit = null; }
    }

    async prompt(prompt: string, options: { model?: string | null; permissionMode?: string; effort?: string } = {}) {
        await this.switchMode('remote');
        const host = this.host;
        if (!host) throw new Error('Muse is not connected');
        if (this.turn) throw new Error('Muse already has an active turn');
        if (options.model && options.model !== 'default') {
            if (!this.models.some(m => m.modelId === options.model)) await this.refreshModels();
            const selected = this.models.find(m => m.modelId === options.model);
            if (!selected) throw new Error(`Muse does not advertise model ${options.model}`);
            await host.connection.command('session/setModel', { sessionId: this.sessionId, model: {
                modelId: options.model, providerId: selected.providerId, profileId: selected.profileId ?? null,
            } });
        }
        if (options.permissionMode) {
            const mode = musePermissionModes.find(m => m.id === options.permissionMode);
            if (!mode) throw new Error(`Unsupported Muse permission mode: ${options.permissionMode}`);
            await host.connection.command('session/setApprovalMode', { sessionId: this.sessionId, mode: mode.native });
            this.permissionMode = mode.id;
            this.callbacks.metadata({ currentOperatingModeCode: mode.id });
        }
        const commandId = host.connection.mintCommandId();
        this.submissions?.record(commandId);
        this.mapper.submitted(commandId);
        const done = new Promise<void>((resolve, reject) => { this.turn = { id: commandId, resolve, reject }; });
        // Install rejection handling before an early terminal notification can arrive.
        void done.catch(() => {});
        try {
            const ack = await host.connection.command('turn/start', { sessionId: this.sessionId,
                input: [{ type: 'text', text: prompt }], ...(options.effort ? { reasoningEffort: options.effort } : {}) }, { commandId });
            this.setTurnId(text(ack.turnId) || commandId);
        } catch (error) { this.finishTurn(error instanceof Error ? error : new Error(String(error))); }
        await done;
    }

    private setTurnId(id: string) { if (this.turn) this.turn.id = id; }

    private finishTurn(error?: Error) {
        const turn = this.turn;
        this.turn = null;
        if (error) turn?.reject(error); else turn?.resolve();
    }

    async cancel() {
        if (this.mode === 'local') { await this.switchMode('remote'); return; }
        if (this.host && this.turn?.id) await this.host.connection.command('turn/cancel', { sessionId: this.sessionId, turnId: this.turn.id });
    }

    dispose(): Promise<void> {
        return this.disposal ??= this.cleanup();
    }

    private async cleanup() {
        this.disposed = true;
        clearInterval(this.poll);
        this.finishTurn(new Error('Muse session closed'));
        await this.operations;
        await this.stopNative();
        await this.closeHost();
    }
}
