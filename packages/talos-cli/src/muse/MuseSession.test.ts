import { describe, it, expect, vi, beforeEach } from 'vitest';
const mock = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('./museClient', () => ({ connectMuse: mock.connect, museExecutable: () => 'muse' }));
import { MuseSession } from './MuseSession';

function fixture() {
    let notify: (method: string, params: any) => void = () => {};
    const command = vi.fn(async (method: string) => method.startsWith('session/') ? { session: { sessionId: 'native-id' }, history: { mode: 'inline', items: [] } } : { turnId: 'turn-1' });
    const request = vi.fn(async () => ({ models: [] }));
    const close = vi.fn(async () => {});
    const host = { connection: { command, request, mintCommandId: () => 'turn-1' }, close, exited: new Promise(() => {}) };
    mock.connect.mockImplementation(async (_: string, callback: typeof notify) => { notify = callback; return host; });
    const callbacks = { message: vi.fn(), metadata: vi.fn(), mode: vi.fn(), activity: vi.fn(), notice: vi.fn(), permission: vi.fn(async () => ({ decision: 'denied' as const })), exited: vi.fn() };
    return { session: new MuseSession('/tmp', callbacks), callbacks, command, request, close, notify: (method: string, params: any) => notify(method, params) };
}
beforeEach(() => vi.clearAllMocks());
describe('MuseSession lifecycle', () => {
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
    it('restores snapshot items from state and suppresses repeated history', async () => {
        const f = fixture();
        const item = { itemId: 'a', kind: 'agentMessage', status: 'completed', text: 'previous answer' };
        f.command.mockResolvedValue({ session: { sessionId: 'native-id' }, history: { mode: 'snapshot', snapshot: { state: { items: [item, item] } } } } as any);
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
        await f.session.dispose();
    });

});
