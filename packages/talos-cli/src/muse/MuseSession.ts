import { prepareMuseAttachments } from './museAttachments';
import type { PendingAttachment } from '@/utils/MessageQueue2';
import type { FileStatusReason } from '@/api/types';
import { parseMuseControls, museEffort, museWireEffort, museHostArgs, museTerminalArgs, musePermissionFromNative, museEffortLevels, type MuseControlState, type MuseControlStore } from './museControls';
import { assertMuseNativeArgs, assertMuseRoute, museModelRestriction, museSupportedModel } from './museModelPolicy';
import { realpathSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import type { SpawnedMspConnection } from '@muse-code/sdk';
import type { PermissionResult } from '@/utils/BasePermissionHandler';
import { connectMuse, museExecutable } from './museClient';
import { approvalChoice, museToolName, MuseMessageMapper, musePermissionModes, object, text, type JsonObject, type MuseMessage } from './museProtocol';
import { ensureMuseSessionPlugin, registerMuseSessionBridge, museSessionInstructions } from './museSessionBridge';

export interface MuseSessionCallbacks {
    message(message: MuseMessage): void;
    metadata(metadata: JsonObject): void;
    mode(mode: 'local' | 'remote'): void;
    activity(thinking: boolean): void;
    notice(message: string): void;
    permission(id: string, tool: string, input: unknown): Promise<PermissionResult>;
    cancelPermission?(id: string): void;
    fileStatus?(ref: string, status: 'accepted' | 'rejected', reason?: FileStatusReason): void;
    exited(error?: Error): void;
}

/** Owns only the native process/protocol boundary. Talos owns transport and UI. */
export class MuseSession {
    readonly supportsAttachments = true;
    private host: SpawnedMspConnection | null = null;
    private hostArguments: string[] = [];
    private nativeHandoff = false;
    private native: ChildProcess | null = null;
    private nativeExit: Promise<void> | null = null;
    private mapper = new MuseMessageMapper();
    private poll: ReturnType<typeof setInterval> | undefined;
    private reading = false;
    private disposed = false;
    private disposal: Promise<void> | undefined;
    private unregisterBridge?: () => Promise<void>;
    private needsSessionInstructions = false;
    private controls: MuseControlState = { permissionMode: 'default', effort: 'high', hostArgs: [] };
    private get permissionMode() { return this.controls.permissionMode; }
    private set permissionMode(mode: string) { this.controls.permissionMode = mode; }
    private readonly parsedControls: ReturnType<typeof parseMuseControls>;
    private questions = new Set<string>();
    private transitioning = false;
    private operations: Promise<unknown> = Promise.resolve();
    private turn: { id?: string; resolve(): void; reject(error: Error): void } | null = null;
    private approvals = new Map<string, string>();
    private approvalRequests = new Map<string, JsonObject>();
    private modelFailure: Error | undefined;
    sessionId = '';
    mode: 'local' | 'remote' = 'remote';

    constructor(private readonly cwd: string, private readonly callbacks: MuseSessionCallbacks,
        private readonly nativeArgs: string[] = [],
        private readonly submissions?: { load(): string[]; record(commandId: string): void },
        private readonly controlStore?: MuseControlStore,
        private readonly sessionToolsUrl?: string) {
        assertMuseNativeArgs(nativeArgs);
        this.parsedControls = parseMuseControls(nativeArgs);
        this.controls = { ...this.controls, ...this.parsedControls.overrides };
        for (const id of submissions?.load() ?? []) this.mapper.submitted(id);
    }

    private serialize<T>(action: () => Promise<T>): Promise<T> {
        const result = this.operations.then(action);
        this.operations = result.catch(() => {});
        return result;
    }

    private async connect() {
        const host = await connectMuse(this.cwd, (method, params) => this.notification(method, params), museHostArgs(this.controls));
        this.host = host;
        this.hostArguments = museHostArgs(this.controls);
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
        if (this.sessionToolsUrl) {
            await ensureMuseSessionPlugin();
            this.unregisterBridge = await registerMuseSessionBridge(this.sessionToolsUrl);
            this.needsSessionInstructions = !resumeId && mode === 'remote';
        }
        this.sessionId = resumeId ?? '';
        this.nativeHandoff = Boolean(resumeId);
        if (resumeId) {
            const saved = this.controlStore?.load(resumeId);
            if (saved) {
                museEffort(saved.effort);
                if (!Array.isArray(saved.hostArgs) || saved.hostArgs.some(arg => typeof arg !== 'string')) throw new Error('Invalid saved Muse host options');
                const parsedHost = parseMuseControls(saved.hostArgs);
                if (parsedHost.remaining.length || parsedHost.overrides.effort || parsedHost.overrides.permissionMode) throw new Error('Invalid saved Muse host options');
                if (!musePermissionModes.some(m => m.id === saved.permissionMode)) throw new Error('Invalid saved Muse permission mode');
                this.controls = { ...saved, ...this.parsedControls.overrides };
            }
        }
        const host = await this.connect();
        const result = resumeId
            ? await this.resumeHost(host, resumeId)
            : await host.connection.command('session/start', { workspaceRoot: this.cwd, approvalMode: musePermissionModes.find(m => m.id === this.permissionMode)!.native });
        const session = object(result.session);
        this.checkRoute(session);
        this.sessionId = text(session.sessionId);
        if (!this.sessionId) throw new Error('Muse returned no session identity');
        if (text(session.workspaceRoot) && realpathSync(text(session.workspaceRoot)) !== realpathSync(this.cwd)) {
            throw new Error(`Muse session belongs to ${text(session.workspaceRoot)}. Run Talos from that workspace.`);
        }
        this.permissionMode = musePermissionFromNative(text(object(session.approvalMode).mode), this.permissionMode);
        if (this.parsedControls.overrides.permissionMode) {
            this.permissionMode = this.parsedControls.overrides.permissionMode;
            await this.applyApprovalMode(host);
        }
        this.persistControls();
        this.callbacks.metadata({ museSessionId: this.sessionId });
        await this.history(result);
        await this.refreshModels();
        if (mode === 'local') await this.switchMode('local');
        else this.callbacks.mode('remote');
    }

    private persistControls() {
        if (this.sessionId) this.controlStore?.save(this.sessionId, this.controls);
    }

    private async applyApprovalMode(host: SpawnedMspConnection) {
        const mode = musePermissionModes.find(m => m.id === this.permissionMode)!;
        await host.connection.command('session/setApprovalMode', { sessionId: this.sessionId, mode: mode.native });
    }

    private async resumeHost(host: SpawnedMspConnection, sessionId: string) {
        const stored = object((await host.connection.request('session/read', { sessionId, excludeItems: true })).session);
        this.checkRoute(stored);
        await this.checkModelHistory(host, sessionId);
        const result = await host.connection.command('session/resume', { sessionId, history: 'inline' });
        this.checkRoute(object(result.session));
        return result;
    }

    private checkRoute(route: JsonObject) {
        if (this.modelFailure) throw this.modelFailure;
        try { assertMuseRoute(route); }
        catch (error) { this.modelFailure = error as Error; throw error; }
    }

    private async checkModelHistory(host: SpawnedMspConnection, sessionId: string) {
        let cursor: string | undefined;
        do {
            const page = await host.connection.request('view/page', { sessionId, limit: 1000, ...(cursor ? { cursor } : {}) });
            for (const event of (Array.isArray(page.events) ? page.events : []).map(object)) {
                if (event.method === 'session/modelChanged') this.checkRoute(object(event.params));
            }
            const next = text(page.nextCursor);
            if (next && next === cursor) throw new Error('Muse history cursor did not advance');
            cursor = next || undefined;
        } while (cursor);
    }

    private async history(response: JsonObject) {
        const history = object(response.history);
        const snapshot = object(history.snapshot);
        const items = Array.isArray(history.items) ? history.items : object(snapshot.state).items;
        if (Array.isArray(items)) {
            for (const item of items) this.item(item);
            if (this.mode === 'local') this.callbacks.activity(Boolean(object(snapshot.state).activeTurn));
            if (object(snapshot.state).todoList !== undefined) {
                this.todos(object(snapshot.state).todoList, text(snapshot.viewCursor));
                return;
            }
        }
        if (!history.mode || !this.host) return;
        let cursor: string | undefined;
        do {
            const page = await this.host.connection.request('view/page', { sessionId: this.sessionId, limit: 1000, ...(cursor ? { cursor } : {}) });
            for (const event of Array.isArray(page.events) ? page.events.map(object) : []) {
                if (!Array.isArray(items) && text(event.method).startsWith('item/')) this.item(object(event.params).item);
                if (event.method === 'session/todoListChanged') this.todos(event.params, text(object(event.params).viewCursor));
            }
            const next = text(page.nextCursor);
            if (next && next === cursor) throw new Error('Muse history cursor did not advance');
            cursor = next || undefined;
        } while (cursor && !this.disposed);
    }

    private item(item: unknown) {
        for (const message of this.mapper.map(item)) this.callbacks.message(message);
    }

    private todos(state: unknown, cursor: string) {
        for (const message of this.mapper.todos(state, cursor)) this.callbacks.message(message);
    }

    private notification(method: string, params: JsonObject) {
        if (text(params.sessionId) && text(params.sessionId) !== this.sessionId) return;
        if (method === 'item/started' || method === 'item/updated' || method === 'item/completed') this.item(params.item);
        if (method === 'session/todoListChanged') this.todos(params, text(params.viewCursor));
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
            if (key) {
                this.callbacks.cancelPermission?.(key);
                this.callbacks.message({ id: `muse:${key}:approval-result`, data: {
                    type: 'tool-result', callId: key, id: key, output: `Approval ${text(params.decision) || 'resolved'}`,
                } });
            }
        }
        if (method === 'userInput/requested') void this.answerQuestions(params);
        if (method === 'userInput/settled') {
            const id = text(params.userInputId);
            this.questions.delete(id);
            this.callbacks.cancelPermission?.(id);
        }
        if (method === 'session/approvalModeChanged') {
            this.permissionMode = musePermissionFromNative(text(params.mode), this.permissionMode);
            this.persistControls();
            this.callbacks.metadata({ currentOperatingModeCode: this.permissionMode });
        }
        if (method === 'session/modelChanged') {
            try { this.checkRoute(params); }
            catch (error) { this.callbacks.notice(String(error)); return; }
            void this.refreshModels().catch(error => this.callbacks.notice(String(error)));
        }
    }

    private async approve(params: JsonObject) {
        if (this.mode !== 'remote' || !this.host) return;
        const approvalId = text(params.approvalId);
        const requirement = object(params.currentRequirementId);
        const key = `${approvalId}:${requirement.sourceIndex}`;
        if (!approvalId || this.approvals.get(approvalId) === key) return;
        const previous = this.approvals.get(approvalId);
        this.approvals.set(approvalId, key);
        if (previous) {
            this.callbacks.cancelPermission?.(previous);
            this.callbacks.message({ id: `muse:${previous}:approval-result`, data: {
                type: 'tool-result', callId: previous, id: previous, output: 'Approval stage finished',
            } });
        }
        try {
            let input: unknown = params.rawArgs ?? params.subject;
            try { input = JSON.parse(text(params.rawArgs)); } catch { /* Keep provider input when it is not JSON. */ }
            // Muse 1.0.3 can still deliver MSP approval requests in allowAll/denyUnmatched.
            // Enforce the user's selected non-interactive mode using native offered choices.
            const isSessionTool = Boolean(this.sessionToolsUrl) && [
                'mcp__plugin_talos_session_talos__change_title', 'mcp__plugin_talos_session_talos__present_image',
            ].includes(text(params.toolName));
            const decision: PermissionResult = isSessionTool || ['yolo', 'bypassPermissions'].includes(this.permissionMode)
                ? { decision: 'approved' }
                : this.permissionMode === 'never' ? { decision: 'denied' }
                : await this.callbacks.permission(key, museToolName(params.toolName), input);
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
            let output: unknown = 'Question canceled';
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
                output = { answers: values };
            }
            this.callbacks.message({ id: `muse:${id}:answer`, data: { type: 'tool-result', callId: id, id, output } });
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
        const active = models.find(m => m.isActive);
        if (active) this.checkRoute(active);
        this.callbacks.metadata({ models: [{ code: 'default', value: 'Muse Spark 1.3 Contributor (fixed)', isDefault: true,
                supportedReasoningEfforts: museEffortLevels.map(code => ({ code, value: code })), defaultReasoningEffort: 'high' }],
            currentReasoningEffort: this.controls.effort,
            currentModelCode: 'default',
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
                    const child = spawn(museExecutable(), ['resume', this.sessionId, '--workspace', this.cwd, ...museTerminalArgs(this.controls, this.parsedControls.remaining)], { cwd: this.cwd, stdio: 'inherit' });
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
                    this.nativeHandoff = true;
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
            this.checkRoute(object(result.session));
            this.permissionMode = musePermissionFromNative(text(object(object(result.session).approvalMode).mode), this.permissionMode);
            this.persistControls();
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

    async prompt(prompt: string, options: { model?: string | null; permissionMode?: string; effort?: string } = {}, attachments: PendingAttachment[] = []) {
        await this.switchMode('remote');
        let host = this.host;
        if (!host) throw new Error('Muse is not connected');
        if (this.turn) throw new Error('Muse already has an active turn');
        if (this.modelFailure) throw this.modelFailure;
        if (options.model && options.model !== 'default' && options.model !== museSupportedModel) {
            throw new Error(museModelRestriction);
        }
        // Check native state before every turn; never silently change its model.
        const before = await host.connection.request('session/read', { sessionId: this.sessionId, excludeItems: true });
        this.checkRoute(object(before.session));
        const effort = options.effort ? museEffort(options.effort) : this.controls.effort;
        if (options.permissionMode) {
            const mode = musePermissionModes.find(m => m.id === options.permissionMode);
            if (!mode) throw new Error(`Unsupported Muse permission mode: ${options.permissionMode}`);
            const previous = this.controls;
            const next = { ...previous, permissionMode: mode.id };
            if (JSON.stringify(this.hostArguments) !== JSON.stringify(museHostArgs(next))) {
                await this.closeHost();
                this.controls = next;
                try {
                    host = await this.connect();
                    await this.resumeHost(host, this.sessionId);
                } catch (error) {
                    await this.closeHost();
                    this.controls = previous;
                    try { await this.resumeHost(await this.connect(), this.sessionId); }
                    catch { await this.closeHost(); }
                    throw error;
                }
            }
            // Resume notifications can replay the previous approval projection.
            this.controls = { ...next, permissionMode: mode.id };
            await this.applyApprovalMode(host);
        }
        this.controls.effort = effort;
        this.persistControls();
        this.callbacks.metadata({ currentOperatingModeCode: this.permissionMode, currentReasoningEffort: effort });
        const prepared = await prepareMuseAttachments(attachments, this.sessionId);
        for (const rejected of prepared.rejected) this.callbacks.fileStatus?.(rejected.ref, 'rejected', rejected.reason);
        if (!prompt.trim() && prepared.input.length === 0) return;
        const commandId = host.connection.mintCommandId();
        this.submissions?.record(commandId);
        this.mapper.submitted(commandId);
        const done = new Promise<void>((resolve, reject) => { this.turn = { id: commandId, resolve, reject }; });
        // Install rejection handling before an early terminal notification can arrive.
        void done.catch(() => {});
        try {
            const ack = await host.connection.command('turn/start', { sessionId: this.sessionId,
                input: [...prepared.input, { type: 'text', text: this.needsSessionInstructions
                    ? `Talos session instructions:\n${museSessionInstructions()}\n\nUser message:\n${prompt}` : prompt }],
                ...(this.needsSessionInstructions ? { displayText: prompt } : {}),
                reasoningEffort: museWireEffort(effort) }, { commandId });
            for (const ref of prepared.accepted) this.callbacks.fileStatus?.(ref, 'accepted');
            this.needsSessionInstructions = false;
            this.setTurnId(text(ack.turnId) || commandId);
        } catch (error) {
            for (const ref of prepared.accepted) this.callbacks.fileStatus?.(ref, 'rejected', 'unsupported');
            this.finishTurn(error instanceof Error ? error : new Error(String(error)));
        }
        let recovering = false;
        const recover = async () => {
            if (recovering || !this.turn || this.host !== host) return;
            recovering = true;
            let observer: SpawnedMspConnection | undefined;
            try {
                // A native-terminal resume can stop Muse 1.0.3's live deliveries.
                // Read through a separate observer so paging cannot disturb the writer.
                observer = await connectMuse(this.cwd);
                let cursor = text(before.viewCursor);
                const events: JsonObject[] = [];
                do {
                    const page = await observer.connection.request('view/page', { sessionId: this.sessionId, limit: 1000, ...(cursor ? { cursor } : {}) });
                    events.push(...(Array.isArray(page.events) ? page.events.map(object) : []));
                    const next = text(page.nextCursor);
                    if (next && next === cursor) throw new Error('Muse recovery cursor did not advance');
                    cursor = next;
                } while (cursor && this.turn);
                const terminal = events.find(e => e.method === 'turn/completed' && object(e.params).turnId === this.turn?.id
                    // Read-only folds synthesize "incomplete" while a live writer is running.
                    && !(object(e.params).terminal === 'failed' && (object(e.params).reason === 'incomplete' || object(object(e.params).error).message === 'incomplete')));
                for (const event of events) {
                    if (event.method === 'session/todoListChanged') this.todos(event.params, text(object(event.params).viewCursor));
                }
                if (terminal) {
                    for (const event of events) {
                        if (text(event.method).startsWith('item/')) this.item(object(event.params).item);
                    }
                    this.notification('turn/completed', object(terminal.params));
                } else if (this.turn) {
                    const pending = await host.connection.request('approval/listPending', { sessionId: this.sessionId });
                    for (const request of Array.isArray(pending.approvals) ? pending.approvals : []) this.notification('approval/requested', object(request));
                    for (const request of Array.isArray(pending.userInputs) ? pending.userInputs : []) this.notification('userInput/requested', object(request));
                }
            } catch (error) { this.callbacks.notice(`Muse event recovery failed: ${String(error)}`); }
            finally { await observer?.close(); recovering = false; }
        };
        const recovery = this.nativeHandoff ? setInterval(() => void recover(), 2000) : undefined;
        try { await done; } finally { clearInterval(recovery); }
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
        try {
            await this.stopNative();
            await this.closeHost();
        } finally { await this.unregisterBridge?.(); }
    }
}
