import { describe, expect, it } from 'vitest';
import { approvalChoice, MuseMessageMapper } from './museProtocol';

describe('Muse transcript mapping', () => {
    it('projects native todos into the shared task list, preserving clears and revision resets', () => {
        const mapper = new MuseMessageMapper();
        const first = { revision: 9, items: [{ text: 'Investigate', status: 'inProgress' }, { text: 'Verify', status: 'pending' }, { text: 'Dropped', status: 'cancelled' }] };
        const messages = mapper.todos(first, 'cursor-1');
        expect(messages[0].data).toMatchObject({ name: 'TodoWrite', input: { todos: [
            { content: 'Investigate', status: 'in_progress' }, { content: 'Verify', status: 'pending' },
        ] } });
        expect(messages[1].data).toMatchObject({ output: { newTodos: [
            { content: 'Investigate', status: 'in_progress' }, { content: 'Verify', status: 'pending' },
        ] } });
        expect(mapper.todos(first, 'cursor-1')).toEqual([]);
        expect(mapper.todos({ revision: 1, items: [] }, 'cursor-2')[1].data).toMatchObject({ output: { newTodos: [] } });
        expect(mapper.todos(first, 'cursor-3')).toHaveLength(2);
        expect(mapper.map({ itemId: 'native-todo', kind: 'toolCall', tool: 'write_todos', status: 'completed', args: '{"todos":[]}' })).toEqual([]);
    });
    it('imports native prompts but does not duplicate Talos-submitted prompts', () => {
        const mapper = new MuseMessageMapper();
        mapper.submitted('talos-command');
        expect(mapper.map({ itemId: 'a', kind: 'userMessage', status: 'completed', commandId: 'talos-command', text: 'hello' })).toEqual([]);
        expect(mapper.map({ itemId: 'b', kind: 'userMessage', status: 'completed', commandId: 'native-command', text: 'hello' })).toEqual([{ id: 'muse:b:user', user: 'hello' }]);
    });
    it('uses authoritative final text and ignores repeated history snapshots', () => {
        const mapper = new MuseMessageMapper();
        expect(mapper.map({ itemId: 'a', kind: 'agentMessage', status: 'inProgress', text: 'partial' })).toEqual([]);
        const final = { itemId: 'a', kind: 'agentMessage', status: 'completed', text: 'correct final' };
        expect(mapper.map(final)[0].data).toEqual({ type: 'message', message: 'correct final' });
        expect(mapper.map(final)).toEqual([]);
        expect(new MuseMessageMapper().map(final)[0].id).toBe('muse:a:text');
    });
    it('pairs a tool result even when its start was missed and preserves errors', () => {
        const mapper = new MuseMessageMapper();
        const events = mapper.map({ itemId: 'tool1', kind: 'toolCall', status: 'failed', tool: 'bash', args: '{"command":"false"}', visibleOutput: 'exit 1' });
        expect(events.map(e => e.data?.type)).toEqual(['tool-call', 'tool-result']);
        expect(events[0].data).toMatchObject({ callId: 'tool1', name: 'Bash', input: { command: 'false' } });
        expect(events[1].data).toMatchObject({ callId: 'tool1', isError: true, output: 'exit 1' });
    });
    it('maps native question tools and persisted answers into the existing question UI', () => {
        const events = new MuseMessageMapper().map({ itemId: 'question', kind: 'toolCall', status: 'completed', tool: 'request_user_input',
            args: JSON.stringify({ questions: [{ id: 'color', question: 'Which color?', options: [{ label: 'Blue' }], selection: { mode: 'single' } }] }),
            visibleOutput: JSON.stringify({ status: 'answered', answers: [{ id: 'color', selected_label: 'Blue' }] }),
        });
        expect(events[0].data).toMatchObject({ name: 'AskUserQuestion', input: { questions: [{ allowFreeText: true, multiSelect: false }] } });
        expect(events[1].data).toMatchObject({ output: { answers: { 'Which color?': 'Blue' } } });
    });

    it('does not expose raw reasoning text', () => {
        const mapper = new MuseMessageMapper();
        expect(mapper.map({ itemId: 'r', kind: 'reasoning', status: 'completed', text: 'private', summary: ['Public summary'] })[0].data).toEqual({ type: 'reasoning', message: 'Public summary' });
    });
});

describe('Muse approval choices', () => {
    const request = { availableChoices: [
        { choiceId: 'once', decision: 'approved', scope: 'once' },
        { choiceId: 'permanent', decision: 'approvedPolicyAmendment', scope: 'localPersistent' },
        { choiceId: 'deny', decision: 'denied', scope: 'once' },
    ] };
    it('never turns session approval into a permanent policy', () => {
        expect(approvalChoice(request, 'approved_for_session')).toBe('once');
        expect(approvalChoice({ availableChoices: [request.availableChoices[1]] }, 'approved_for_session')).toBeNull();
    });
    it('chooses only an advertised denial or abort', () => {
        expect(approvalChoice(request, 'abort')).toBe('deny');
        expect(approvalChoice({ availableChoices: [] }, 'approved')).toBeNull();
    });
});
