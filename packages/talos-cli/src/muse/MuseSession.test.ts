import { describe, it, expect, vi, beforeEach } from 'vitest';
const mock = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('./museClient', () => ({ connectMuse: mock.connect, museExecutable: () => 'muse' }));
vi.mock('./museSessionBridge', () => ({ ensureMuseSessionPlugin: vi.fn(), registerMuseSessionBridge: vi.fn(async () => vi.fn()), museSessionInstructions: () => 'Use the Talos session tools.' }));
import { MuseSession } from './MuseSession';

function fixture(sessionToolsUrl?: string) {
    let notify: (method: string, params: any) => void = () => {};
    const command = vi.fn(async (method: string, _params?: unknown, _options?: unknown) => method.startsWith('session/') ? { session: { sessionId: 'native-id', modelId: 'muse-spark-1.3-contributor', providerId: 'meta' }, history: { mode: 'inline', items: [] } } : { turnId: 'turn-1' });
    const request = vi.fn(async (_method: string) => ({ models: [], session: { modelId: 'muse-spark-1.3-contributor', providerId: 'meta' } } as any));
    const close = vi.fn(async () => {});
    const host = { connection: { command, request, mintCommandId: () => 'turn-1' }, close, exited: new Promise(() => {}) };
    mock.connect.mockImplementation(async (_: string, callback: typeof notify) => { notify = callback; return host; });
    const callbacks = { message: vi.fn(), metadata: vi.fn(), mode: vi.fn(), activity: vi.fn(), notice: vi.fn(), permission: vi.fn(async () => ({ decision: 'denied' as const })), exited: vi.fn() };
    return { session: new MuseSession('/tmp', callbacks, [], undefined, undefined, sessionToolsUrl), callbacks, command, request, close, notify: (method: string, params: any) => notify(method, params) };
}
beforeEach(() => vi.clearAllMocks());
describe('MuseSession lifecycle', () => {
    it('introduces session tools once while preserving the displayed user prompt', async () => {
        const f = fixture('http://127.0.0.1:1234'); await f.session.start();
        f.command.mockImplementation(async method => {
            if (method === 'turn/start') f.notify('turn/completed', { turnId: 'turn-1' });
            return { turnId: 'turn-1' } as any;
        });
        await f.session.prompt('Review the file');
        expect(f.command).toHaveBeenCalledWith('turn/start', expect.objectContaining({
            displayText: 'Review the file', input: [{ type: 'text', text: expect.stringContaining('Use the Talos session tools.') }],
        }), expect.anything());
        await f.session.prompt('Continue');
        expect(f.command).toHaveBeenLastCalledWith('turn/start', expect.objectContaining({ input: [{ type: 'text', text: 'Continue' }] }), expect.anything());
        expect(f.command.mock.calls.at(-1)?.[1]).not.toHaveProperty('displayText');
        await f.session.dispose();
    });
    it('forwards live todo updates and ignores other sessions', async () => {
        const f = fixture(); await f.session.start();
        const params = { sessionId: 'native-id', viewCursor: 'todo-1', items: [{ text: 'Verify', status: 'inProgress' }] };
        f.notify('session/todoListChanged', { ...params, sessionId: 'another-session' });
        expect(f.callbacks.message).not.toHaveBeenCalled();
        f.notify('session/todoListChanged', params);
        f.notify('session/todoListChanged', params);
        expect(f.callbacks.message).toHaveBeenCalledTimes(2);
        expect(f.callbacks.message.mock.calls[1][0].data.output.newTodos).toEqual([{ content: 'Verify', status: 'in_progress' }]);
        await f.session.dispose();
    });
    it('restores todos from a snapshot without replaying older plans', async () => {
        const f = fixture();
        f.command.mockResolvedValue({ session: { sessionId: 'native-id', modelId: 'muse-spark-1.3-contributor', providerId: 'meta' }, history: {
            mode: 'snapshot', snapshot: { viewCursor: 'snapshot-1', state: { items: [], todoList: { items: [{ text: 'Verify', status: 'completed' }] } } },
        } } as any);
        await f.session.start();
        expect(f.callbacks.message.mock.calls[1][0].data.output.newTodos).toEqual([{ content: 'Verify', status: 'completed' }]);
        expect(f.request).not.toHaveBeenCalledWith('view/page', expect.anything());
        await f.session.dispose();
    });
    it('restores todo events even when resume includes inline transcript items', async () => {
        const f = fixture();
        f.request.mockImplementation(async method => method === 'view/page' ? {
            events: [{ method: 'session/todoListChanged', params: { viewCursor: 'todo-1', items: [] } }], nextCursor: null,
        } : { models: [] });
        await f.session.start();
        expect(f.callbacks.message.mock.calls[1][0].data.output.newTodos).toEqual([]);
        await f.session.dispose();
    });
    it('completes a turn whose terminal arrives before its command ack', async () => {
        const f = fixture(); await f.session.start();
        f.command.mockImplementation(async (method) => {
            if (method === 'turn/start') {
                f.notify('turn/started', { sessionId: 'native-id', turnId: 'turn-1' });
                f.notify('turn/completed', { sessionId: 'native-id', turnId: 'turn-1', terminal: 'completed' });
            }
            return { turnId: 'turn-1' } as any;
        });
        await f.session.prompt('hello');
        await Promise.all([f.session.dispose(), f.session.dispose()]);
        expect(f.close).toHaveBeenCalledTimes(1);
    });
    it('recovers a resumed turn without treating an incomplete live fold as failure', async () => {
        const f = fixture(); await f.session.start('native-id');
        let pages = 0;
        f.request.mockImplementation(async method => {
            if (method === 'view/page') return { events: ++pages === 1
                ? [{ method: 'turn/completed', params: { turnId: 'turn-1', terminal: 'failed', reason: 'incomplete' } }]
                : [{ method: 'item/completed', params: { item: { itemId: 'recovered', kind: 'agentMessage', status: 'completed', text: 'recovered reply' } } },
                   { method: 'turn/completed', params: { turnId: 'turn-1', terminal: 'completed' } }], nextCursor: null };
            return { session: { modelId: 'muse-spark-1.3-contributor', providerId: 'meta' }, viewCursor: 'observed-cursor' };
        });
        await f.session.prompt('hello');
        expect(pages).toBe(2);
        expect(f.request).toHaveBeenCalledWith('view/page', expect.objectContaining({ cursor: 'observed-cursor' }));
        expect(f.callbacks.message).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ message: 'recovered reply' }) }));
        await f.session.dispose();
    }, 10000);
    it.each([['yolo', 'approved'], ['bypassPermissions', 'approved'], ['never', 'denied']])('handles native approval requests without prompting in %s mode', async (mode, decision) => {
        const f = fixture();
        const session = new MuseSession('/tmp', f.callbacks, mode === 'yolo' ? ['--yolo'] : mode === 'never' ? ['--approval-mode', 'never'] : ['--disable-approval']);
        await session.start();
        f.notify('approval/requested', { sessionId: 'native-id', approvalId: 'approval', toolName: 'bash', rawArgs: '{"command":"true"}',
            currentRequirementId: { approvalId: 'approval', sourceIndex: 0 },
            availableChoices: [{ choiceId: 'allow-once', decision: 'approved', scope: 'once' }, { choiceId: 'deny', decision: 'denied', scope: 'once' }] });
        await vi.waitFor(() => expect(f.command).toHaveBeenCalledWith('approval/decide', expect.objectContaining({ choiceId: decision === 'approved' ? 'allow-once' : 'deny' })));
        expect(f.callbacks.permission).not.toHaveBeenCalled();
        await session.dispose();
    });
    it('restores snapshot items from state and suppresses repeated history', async () => {
        const f = fixture();
        const item = { itemId: 'a', kind: 'agentMessage', status: 'completed', text: 'previous answer' };
        f.command.mockResolvedValue({ session: { sessionId: 'native-id', modelId: 'muse-spark-1.3-contributor', providerId: 'meta' }, history: { mode: 'snapshot', snapshot: { state: { items: [item, item] } } } } as any);
        await f.session.start('native-id');
        expect(f.callbacks.message).toHaveBeenCalledTimes(1);
        expect(f.callbacks.message.mock.calls[0][0].data.message).toBe('previous answer');
        await f.session.dispose();
    });
    it('preserves permission mode when models refresh', async () => {
        const f = fixture(); await f.session.start();
        f.command.mockImplementation(async (method) => {
            if (method === 'turn/start') f.notify('turn/completed', { turnId: 'turn-1' });
            return {} as any;
        });
        await f.session.prompt('hello', { permissionMode: 'safe-yolo' });
        await f.session.refreshModels();
        expect(f.callbacks.metadata).toHaveBeenLastCalledWith(expect.objectContaining({ currentOperatingModeCode: 'safe-yolo' }));
        await f.session.dispose();
    });
    it('rejects an unsupported permission mode before submitting a turn', async () => {
        const f = fixture(); await f.session.start();
        await expect(f.session.prompt('hello', { permissionMode: 'read-only' })).rejects.toThrow('Unsupported');
        expect(f.command.mock.calls.some(([method]) => method === 'turn/start')).toBe(false);
        await f.session.dispose();
    });
    it('answers multiple choices without splitting labels containing commas', async () => {
        const f = fixture(); await f.session.start();
        f.callbacks.permission.mockResolvedValue({ decision: 'approved', updatedInput: {
            answers: { 'Choose': 'red, green, blue' }, selectedLabels: { 'Choose': ['red, green', 'blue'] },
        } } as any);
        f.notify('userInput/requested', { sessionId: 'native-id', userInputId: 'question-1', questions: [
            { id: 'q1', question: 'Choose', header: 'Colors', options: [{ label: 'red, green' }, { label: 'blue' }], selection: { mode: 'multiple' } },
        ] });
        await vi.waitFor(() => expect(f.command).toHaveBeenCalledWith('userInput/answer', {
            sessionId: 'native-id', userInputId: 'question-1', answers: [{ questionId: 'q1', selectedLabels: ['red, green', 'blue'] }],
        }));
        expect(f.callbacks.message).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ name: 'AskUserQuestion' }) }));
        await vi.waitFor(() => expect(f.callbacks.message).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
            type: 'tool-result', output: { answers: { Choose: 'red, green, blue' } },
        }) })));

        await f.session.dispose();
    });

    it('ignores a stale approval result after the requirement advances', async () => {
        const f = fixture(); await f.session.start();
        let resolveFirst: (decision: any) => void = () => {};
        f.callbacks.permission.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
        const request = { sessionId: 'native-id', approvalId: 'approval', toolName: 'shell',
            availableChoices: [{ choiceId: 'deny', decision: 'denied', scope: 'once' }] };
        f.notify('approval/requested', { ...request, currentRequirementId: { approvalId: 'approval', sourceIndex: 1 } });
        f.notify('approval/updated', { ...request, currentRequirementId: { approvalId: 'approval', sourceIndex: 2 } });
        resolveFirst({ decision: 'denied' });
        await vi.waitFor(() => expect(f.command).toHaveBeenCalledWith('approval/decide', expect.objectContaining({
            requirementId: { approvalId: 'approval', sourceIndex: 2 }, choiceId: 'deny',
        })));
        expect(f.command.mock.calls.filter(([method]) => method === 'approval/decide')).toHaveLength(1);
        f.notify('approval/resolved', { sessionId: 'native-id', approvalId: 'approval', decision: 'denied' });
        expect(f.callbacks.message).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
            type: 'tool-result', callId: 'approval:2', output: 'Approval denied',
        }) }));
        await f.session.dispose();
    });

    it('rejects model changes without submitting a turn or changing native state', async () => {
        const f = fixture(); await f.session.start();
        await expect(f.session.prompt('hello', { model: 'muse-spark-1.3' })).rejects.toThrow('temporarily disabled');
        expect(f.command.mock.calls.some(([method]) => method === 'turn/start' || method === 'session/setModel')).toBe(false);
        await f.session.dispose();
    });

    it('rejects a non-default stored route before native resume can overwrite it', async () => {
        const f = fixture();
        f.request.mockResolvedValue({ session: { modelId: 'muse-spark-1.3', providerId: 'meta' } });
        await expect(f.session.start('native-id')).rejects.toThrow('temporarily disabled');
        expect(f.command).not.toHaveBeenCalled();
        await f.session.dispose();
    });

    it('rejects model-switch history even when the current route is back to default', async () => {
        const f = fixture();
        f.request.mockImplementation(async method => method === 'view/page'
            ? { events: [{ method: 'session/modelChanged', params: { modelId: 'muse-spark-1.3', providerId: 'meta' } }] }
            : { session: { modelId: 'muse-spark-1.3-contributor', providerId: 'meta' } });
        await expect(f.session.start('native-id')).rejects.toThrow('temporarily disabled');
        expect(f.command).not.toHaveBeenCalled();
        await f.session.dispose();
    });

    it('keeps a native model change blocked even after it changes back', async () => {
        const f = fixture(); await f.session.start();
        f.notify('session/modelChanged', { sessionId: 'native-id', modelId: 'muse-spark-1.3', providerId: 'meta' });
        f.notify('session/modelChanged', { sessionId: 'native-id', modelId: 'muse-spark-1.3-contributor', providerId: 'meta' });
        await expect(f.session.prompt('hello')).rejects.toThrow('temporarily disabled');
        expect(f.command.mock.calls.some(([method]) => method === 'turn/start')).toBe(false);
        await f.session.dispose();
    });

    it('checks live native routing before sending a prompt', async () => {
        const f = fixture(); await f.session.start();
        f.request.mockResolvedValue({ session: { modelId: 'muse-spark-1.3', providerId: 'meta' } });
        await expect(f.session.prompt('hello')).rejects.toThrow('temporarily disabled');
        expect(f.command.mock.calls.some(([method]) => method === 'turn/start')).toBe(false);
        await f.session.dispose();
    });
    it('applies every approval policy and restarts the host only when sandbox posture changes', async () => {
        const f = fixture(); await f.session.start();
        f.command.mockImplementation(async (method) => {
            if (method === 'turn/start') f.notify('turn/completed', { turnId: 'turn-1' });
            return { session: { sessionId: 'native-id', modelId: 'muse-spark-1.3-contributor', providerId: 'meta' } } as any;
        });
        for (const [permissionMode, native] of [['default', 'promptUnmatched'], ['safe-yolo', 'onRequest'], ['never', 'denyUnmatched'], ['bypassPermissions', 'allowAll'], ['yolo', 'allowAll']]) {
            await f.session.prompt('hello', { permissionMode, effort: 'max' });
            expect(f.command).toHaveBeenCalledWith('session/setApprovalMode', { sessionId: 'native-id', mode: native });
        }
        expect(mock.connect).toHaveBeenCalledTimes(2);
        expect(mock.connect).toHaveBeenLastCalledWith('/tmp', expect.any(Function), ['--disable-sandbox', '--trust-workspace']);
        expect(f.command).toHaveBeenCalledWith('turn/start', expect.objectContaining({ reasoningEffort: 'xhigh' }), expect.anything());
        await f.session.prompt('hello', { permissionMode: 'default', effort: 'none' });
        expect(mock.connect).toHaveBeenCalledTimes(3);
        expect(mock.connect).toHaveBeenLastCalledWith('/tmp', expect.any(Function), []);
        expect(f.session.sessionId).toBe('native-id');
        await f.session.dispose();
    });

    it('restores persisted controls before connecting a resumed host', async () => {
        const f = fixture();
        const store = { load: vi.fn(() => ({ permissionMode: 'yolo', effort: 'ultra' as const, hostArgs: [] })), save: vi.fn() };
        const session = new MuseSession('/tmp', f.callbacks, [], undefined, store);
        await session.start('native-id');
        expect(mock.connect).toHaveBeenCalledWith('/tmp', expect.any(Function), ['--disable-sandbox', '--trust-workspace']);
        expect(f.callbacks.metadata).toHaveBeenLastCalledWith(expect.objectContaining({ currentOperatingModeCode: 'yolo', currentReasoningEffort: 'ultra' }));
        expect(store.save).toHaveBeenCalledWith('native-id', { permissionMode: 'yolo', effort: 'ultra', hostArgs: [] });
        await session.dispose();
    });

    it('rejects invalid effort before submitting or changing approval settings', async () => {
        const f = fixture(); await f.session.start();
        await expect(f.session.prompt('hello', { effort: 'invented', permissionMode: 'yolo' })).rejects.toThrow('Unsupported Muse reasoning effort');
        expect(mock.connect).toHaveBeenCalledTimes(1);
        expect(f.command.mock.calls.some(([method]) => method === 'turn/start' || method === 'session/setApprovalMode')).toBe(false);
        await f.session.dispose();
    });

});
