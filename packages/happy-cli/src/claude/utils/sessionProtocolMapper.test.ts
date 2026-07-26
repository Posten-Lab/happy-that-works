import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createId, isCuid } from '@paralleldrive/cuid2';
import {
    closeClaudeTurnWithStatus,
    mapClaudeLogMessageToSessionEnvelopes,
} from './sessionProtocolMapper';

describe('mapClaudeLogMessageToSessionEnvelopes', () => {
    it('maps user text to a user text envelope', () => {
        const result = mapClaudeLogMessageToSessionEnvelopes({
            type: 'user',
            uuid: 'u-1',
            message: {
                role: 'user',
                content: 'hello from user',
            },
            timestamp: '2025-01-01T00:00:00.000Z',
        } as any, { currentTurnId: null });

        expect(result.currentTurnId).toBeNull();
        expect(result.envelopes).toHaveLength(1);
        expect(result.envelopes[0].role).toBe('user');
        expect(result.envelopes[0].ev).toEqual({ t: 'text', text: 'hello from user' });
    });

    it('maps non-tool user array text to user text without opening an agent turn', () => {
        const result = mapClaudeLogMessageToSessionEnvelopes({
            type: 'user',
            uuid: 'u-array-1',
            isSidechain: false,
            message: {
                role: 'user',
                content: [
                    { type: 'text', text: 'look at this image' },
                    {
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: 'image/png',
                            data: 'iVBORw0KGgo=',
                        },
                    },
                ],
            },
            timestamp: '2025-01-01T00:00:00.000Z',
        } as any, { currentTurnId: null });

        expect(result.currentTurnId).toBeNull();
        expect(result.envelopes).toHaveLength(1);
        expect(result.envelopes[0].role).toBe('user');
        expect(result.envelopes[0].turn).toBeUndefined();
        expect(result.envelopes[0].ev).toEqual({ t: 'text', text: 'look at this image' });
    });

    it('starts a turn and maps assistant text blocks', () => {
        const result = mapClaudeLogMessageToSessionEnvelopes({
            type: 'assistant',
            uuid: 'a-1',
            message: {
                role: 'assistant',
                content: [
                    { type: 'text', text: 'working...' },
                    { type: 'thinking', thinking: 'internal' },
                ],
            },
            timestamp: '2025-01-01T00:00:01.000Z',
        } as any, { currentTurnId: null });

        expect(result.currentTurnId).not.toBeNull();
        expect(result.envelopes).toHaveLength(3);
        expect(result.envelopes[0].ev.t).toBe('turn-start');
        expect(result.envelopes[1].ev).toEqual({ t: 'text', text: 'working...' });
        expect(result.envelopes[2].ev).toEqual({ t: 'text', text: 'internal', thinking: true });
    });

    it('maps tool use and tool result blocks to tool-call lifecycle', () => {
        const started = mapClaudeLogMessageToSessionEnvelopes({
            type: 'assistant',
            uuid: 'a-2',
            message: {
                role: 'assistant',
                content: [
                    { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls' } },
                ],
            },
        } as any, { currentTurnId: null });

        expect(started.envelopes.some((e) => e.ev.t === 'tool-call-start')).toBe(true);

        const ended = mapClaudeLogMessageToSessionEnvelopes({
            type: 'user',
            uuid: 'u-2',
            message: {
                role: 'user',
                content: [
                    { type: 'tool_result', tool_use_id: 'tool-1', content: 'ok' },
                ],
            },
        } as any, { currentTurnId: started.currentTurnId });

        expect(ended.currentTurnId).toBe(started.currentTurnId);
        expect(ended.envelopes).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    // The result is forwarded now: dropping it meant clients
                    // saw every tool finish with no output at all.
                    ev: { t: 'tool-call-end', call: 'tool-1', result: 'ok' },
                }),
            ]),
        );
    });

    it('exposes the generated session subagent id on Agent tool calls', () => {
        const started = mapClaudeLogMessageToSessionEnvelopes({
            type: 'assistant',
            uuid: 'a-agent-1',
            message: {
                role: 'assistant',
                content: [
                    {
                        type: 'tool_use',
                        id: 'tool-agent-1',
                        name: 'Agent',
                        input: {
                            description: 'Inspect translations',
                            prompt: 'Review all translation files',
                            mode: 'auto',
                        },
                    },
                ],
            },
        } as any, { currentTurnId: null });

        const toolCall = started.envelopes.find((envelope) => {
            return envelope.ev.t === 'tool-call-start'
                && envelope.ev.call === 'tool-agent-1';
        });

        expect(toolCall).toBeDefined();
        expect(toolCall?.ev).toEqual(expect.objectContaining({
            t: 'tool-call-start',
            name: 'Agent',
            title: 'Inspect translations',
            description: 'Inspect translations',
            args: expect.objectContaining({
                description: 'Inspect translations',
                prompt: 'Review all translation files',
                mode: 'auto',
                sessionSubagent: expect.any(String),
            }),
        }));

        if (toolCall?.ev.t === 'tool-call-start') {
            expect(isCuid(String(toolCall.ev.args.sessionSubagent))).toBe(true);
        }
    });

    it('uses parent_tool_use_id as subagent and emits subagent start', () => {
        const mappedSubagent = createId();
        const state = {
            currentTurnId: 'turn-1',
            providerSubagentToSessionSubagent: new Map<string, string>([['task-1', mappedSubagent]]),
        };

        const result = mapClaudeLogMessageToSessionEnvelopes({
            type: 'assistant',
            uuid: 'a-side-1',
            parent_tool_use_id: 'task-1',
            message: {
                role: 'assistant',
                content: [{ type: 'text', text: 'sidechain text' }],
            },
        } as any, state);

        expect(result.envelopes).toHaveLength(2);
        expect(result.envelopes[0].subagent).toBe(mappedSubagent);
        expect(result.envelopes[0].ev).toEqual({ t: 'start' });
        expect(result.envelopes[1].subagent).toBe(mappedSubagent);
        expect(result.envelopes[1].ev).toEqual({ t: 'text', text: 'sidechain text' });
    });

    it('buffers subagent messages until parent Task registration is known', () => {
        const state = { currentTurnId: null };

        const buffered = mapClaudeLogMessageToSessionEnvelopes({
            type: 'assistant',
            uuid: 'a-side-buffered-1',
            parent_tool_use_id: 'task-buffer-1',
            message: {
                role: 'assistant',
                content: [{ type: 'text', text: 'buffer me' }],
            },
        } as any, state);
        expect(buffered.envelopes).toHaveLength(0);

        const parent = mapClaudeLogMessageToSessionEnvelopes({
            type: 'assistant',
            uuid: 'a-parent-buffered-1',
            message: {
                role: 'assistant',
                content: [{
                    type: 'tool_use',
                    id: 'task-buffer-1',
                    name: 'Task',
                    input: { prompt: 'run side task' },
                }],
            },
        } as any, state);

        expect(parent.envelopes.some((envelope) => {
            return envelope.ev.t === 'tool-call-start'
                && envelope.ev.call === 'task-buffer-1';
        })).toBe(false);
        const bufferedText = parent.envelopes.find((envelope) => {
            return envelope.ev.t === 'text'
                && envelope.ev.text === 'buffer me';
        });
        expect(bufferedText?.subagent).toBeDefined();
        expect(isCuid(bufferedText!.subagent!)).toBe(true);
        expect(bufferedText?.subagent).not.toBe('task-buffer-1');
    });

    it('creates and tags subagent chain from Task prompt when parent_tool_use_id is absent', () => {
        const state = { currentTurnId: null };
        const prompt = 'Search for TypeScript 5.6 features';

        const taskToolUse = mapClaudeLogMessageToSessionEnvelopes({
            type: 'assistant',
            uuid: 'task-parent-assistant',
            message: {
                role: 'assistant',
                content: [{
                    type: 'tool_use',
                    id: 'task-call-1',
                    name: 'Task',
                    input: {
                        prompt,
                        description: 'Search TypeScript docs',
                    },
                }],
            },
        } as any, state);

        expect(taskToolUse.envelopes.some((envelope) => {
            return envelope.ev.t === 'tool-call-start'
                && envelope.ev.call === 'task-call-1';
        })).toBe(false);

        const sidechainRoot = mapClaudeLogMessageToSessionEnvelopes({
            type: 'user',
            uuid: 'sidechain-root',
            isSidechain: true,
            parentUuid: null,
            message: {
                role: 'user',
                content: prompt,
            },
        } as any, state);

        expect(sidechainRoot.envelopes).toHaveLength(2);
        const mappedSubagent = sidechainRoot.envelopes[0].subagent;
        expect(mappedSubagent).toBeDefined();
        expect(isCuid(mappedSubagent!)).toBe(true);
        expect(mappedSubagent).not.toBe('task-call-1');
        expect(sidechainRoot.envelopes[0].role).toBe('agent');
        expect(sidechainRoot.envelopes[0].subagent).toBe(mappedSubagent);
        expect(sidechainRoot.envelopes[0].ev).toEqual({ t: 'start', title: 'Search TypeScript docs' });
        expect(sidechainRoot.envelopes[1].subagent).toBe(mappedSubagent);
        expect(sidechainRoot.envelopes[1].ev).toEqual({ t: 'text', text: prompt });

        const sidechainChild = mapClaudeLogMessageToSessionEnvelopes({
            type: 'assistant',
            uuid: 'sidechain-child',
            isSidechain: true,
            parentUuid: 'sidechain-root',
            message: {
                role: 'assistant',
                content: [{ type: 'text', text: 'Subagent result' }],
            },
        } as any, state);

        expect(sidechainChild.envelopes).toHaveLength(1);
        expect(sidechainChild.envelopes[0].subagent).toBe(mappedSubagent);
        expect(sidechainChild.envelopes[0].ev).toEqual({ t: 'text', text: 'Subagent result' });
    });

    it('infers subagent for non-SDK sidechain fixture logs', () => {
        const fixturePath = join(__dirname, '__fixtures__', 'task_non_sdk.jsonl');
        const rows = readFileSync(fixturePath, 'utf8')
            .trim()
            .split('\n')
            .slice(0, 6)
            .map((line) => JSON.parse(line));

        const state = { currentTurnId: null };
        const envelopes = rows.flatMap((row) => {
            return mapClaudeLogMessageToSessionEnvelopes(row as any, state).envelopes;
        });

        const subagentRoot = envelopes.find((envelope) => {
            return envelope.ev.t === 'text'
                && envelope.ev.text.startsWith('Search the web for information about TypeScript 5.6');
        });
        expect(subagentRoot?.subagent).toBeDefined();
        expect(isCuid(subagentRoot!.subagent!)).toBe(true);
        expect(subagentRoot?.subagent).not.toBe('toolu_01EmKA8FJ7B2Ah9seGxK1Wct');

        const subagentChild = envelopes.find((envelope) => {
            return envelope.ev.t === 'text'
                && envelope.ev.text.includes("I'll search for information about TypeScript 5.6");
        });
        expect(subagentChild?.subagent).toBe(subagentRoot?.subagent);
    });

    it('emits stop for completed subagent when parent Task tool returns', () => {
        const mappedSubagent = createId();
        const state = {
            currentTurnId: 'turn-1',
            providerSubagentToSessionSubagent: new Map<string, string>([['task-2', mappedSubagent]]),
            hiddenParentToolCalls: new Set<string>(['task-2']),
        };

        const started = mapClaudeLogMessageToSessionEnvelopes({
            type: 'assistant',
            uuid: 'a-side-2',
            parent_tool_use_id: 'task-2',
            message: {
                role: 'assistant',
                content: [{ type: 'text', text: 'subagent running' }],
            },
        } as any, state);

        expect(started.envelopes.some((envelope) => {
            return envelope.ev.t === 'start' && envelope.subagent === mappedSubagent;
        })).toBe(true);

        const stopped = mapClaudeLogMessageToSessionEnvelopes({
            type: 'user',
            uuid: 'u-parent-2',
            isSidechain: false,
            message: {
                role: 'user',
                content: [{ type: 'tool_result', tool_use_id: 'task-2', content: 'done' }],
            },
        } as any, state);

        expect(stopped.envelopes).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    subagent: mappedSubagent,
                    ev: { t: 'stop' },
                }),
            ]),
        );
        expect(stopped.envelopes.some((envelope) => {
            return envelope.ev.t === 'tool-call-end'
                && envelope.ev.call === 'task-2';
        })).toBe(false);
    });

    it('does not emit envelopes for summary messages', () => {
        const result = mapClaudeLogMessageToSessionEnvelopes({
            type: 'summary',
            summary: 'Done',
            leafUuid: 'leaf-1',
        } as any, { currentTurnId: 'turn-1' });

        expect(result.currentTurnId).toBe('turn-1');
        expect(result.envelopes).toHaveLength(0);
    });

    it('does not emit envelopes for compact summary assistant messages', () => {
        const result = mapClaudeLogMessageToSessionEnvelopes({
            type: 'assistant',
            uuid: 'compact-summary-1',
            isCompactSummary: true,
            message: {
                role: 'assistant',
                content: [{ type: 'text', text: 'Long compaction summary' }],
            },
        } as any, { currentTurnId: 'turn-1' });

        expect(result.currentTurnId).toBe('turn-1');
        expect(result.envelopes).toHaveLength(0);
    });
});

describe('closeClaudeTurnWithStatus', () => {
    it('emits turn-end with provided status when turn is active', () => {
        const result = closeClaudeTurnWithStatus({ currentTurnId: 'turn-1' }, 'cancelled');
        expect(result.currentTurnId).toBeNull();
        expect(result.envelopes).toHaveLength(1);
        expect(result.envelopes[0].ev).toEqual({ t: 'turn-end', status: 'cancelled' });
    });
});

describe('tool-call-end carries the tool result', () => {
    it('prefers the structured toolUseResult over the readable content', () => {
        const started = mapClaudeLogMessageToSessionEnvelopes({
            type: 'assistant',
            message: { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'TaskCreate', input: { subject: 's' } }] },
        } as any, { currentTurnId: null });
        const ended = mapClaudeLogMessageToSessionEnvelopes({
            type: 'user',
            toolUseResult: { task: { id: '7', subject: 's' } },
            message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'Task #7 created successfully: s' }] },
        } as any, { currentTurnId: started.currentTurnId });

        const end = ended.envelopes.find((e) => e.ev.t === 'tool-call-end');
        expect((end!.ev as any).result).toEqual({ task: { id: '7', subject: 's' } });
    });

    it('falls back to text content, and omits the field when there is no output', () => {
        const started = mapClaudeLogMessageToSessionEnvelopes({
            type: 'assistant',
            message: { role: 'assistant', content: [{ type: 'tool_use', id: 'c2', name: 'Bash', input: {} }] },
        } as any, { currentTurnId: null });
        const withText = mapClaudeLogMessageToSessionEnvelopes({
            type: 'user',
            message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c2', content: [{ type: 'text', text: 'hello' }] }] },
        } as any, { currentTurnId: started.currentTurnId });
        expect((withText.envelopes.find((e) => e.ev.t === 'tool-call-end')!.ev as any).result).toBe('hello');

        const started2 = mapClaudeLogMessageToSessionEnvelopes({
            type: 'assistant',
            message: { role: 'assistant', content: [{ type: 'tool_use', id: 'c3', name: 'Bash', input: {} }] },
        } as any, { currentTurnId: null });
        const empty = mapClaudeLogMessageToSessionEnvelopes({
            type: 'user',
            message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c3', content: '' }] },
        } as any, { currentTurnId: started2.currentTurnId });
        expect((empty.envelopes.find((e) => e.ev.t === 'tool-call-end')!.ev as any).result).toBeUndefined();
    });
});

// Claude's Task* calls each report only their own task. The CLI sees the stream
// in order and gets exact ids, so it folds them and republishes the whole list
// as TodoWrite — clients then need no task-specific logic at all.
describe('claude Task* -> folded TodoWrite', () => {
    const call = (id: string, name: string, input: any) => ({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
    } as any);
    const result = (id: string, content: string, toolUseResult?: any) => ({
        type: 'user',
        ...(toolUseResult ? { toolUseResult } : {}),
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] },
    } as any);

    const todosOf = (envs: any[]) => {
        const end = [...envs].reverse().find((e) => e.ev.t === 'tool-call-end' && e.ev.result?.newTodos);
        return end?.ev.result.newTodos;
    };

    it('builds the whole list from creates and updates, with exact ids', () => {
        const state: any = { currentTurnId: null };
        let envs: any[] = [];
        const step = (m: any) => { const r = mapClaudeLogMessageToSessionEnvelopes(m, state); state.currentTurnId = r.currentTurnId; envs = r.envelopes; };

        step(call('c1', 'TaskCreate', { subject: 'Phase 0' }));
        step(result('c1', 'Task #1 created successfully: Phase 0'));
        expect(todosOf(envs)).toEqual([{ content: 'Phase 0', status: 'pending' }]);

        step(call('c2', 'TaskCreate', { subject: 'Phase 1' }));
        step(result('c2', 'Task #2 created successfully: Phase 1'));
        step(call('c3', 'TaskUpdate', { taskId: '1', status: 'completed' }));
        step(result('c3', 'Updated task #1 status'));

        expect(todosOf(envs)).toEqual([
            { content: 'Phase 0', status: 'completed' },
            { content: 'Phase 1', status: 'pending' },
        ]);
    });

    it('prefers the structured result and keeps concurrent in-progress steps', () => {
        const state: any = { currentTurnId: null };
        let envs: any[] = [];
        const step = (m: any) => { const r = mapClaudeLogMessageToSessionEnvelopes(m, state); state.currentTurnId = r.currentTurnId; envs = r.envelopes; };

        step(call('c1', 'TaskList', {}));
        step(result('c1', '', { tasks: [
            { id: '1', subject: 'a', status: 'completed', blockedBy: [] },
            { id: '2', subject: 'b', status: 'in_progress', blockedBy: [] },
            { id: '3', subject: 'c', status: 'in_progress', blockedBy: [] },
            { id: '4', subject: 'd', status: 'pending', blockedBy: ['2', '3'] },
        ] }));

        expect(todosOf(envs)).toEqual([
            { content: 'a', status: 'completed' },
            { content: 'b', status: 'in_progress' },
            { content: 'c', status: 'in_progress' },
            { content: 'd [blocked by #2, #3]', status: 'pending' },
        ]);
    });

    it('does not publish the raw Task* calls themselves', () => {
        const state: any = { currentTurnId: null };
        const started = mapClaudeLogMessageToSessionEnvelopes(call('c1', 'TaskCreate', { subject: 'x' }), state);
        expect(started.envelopes.some((e: any) => e.ev.name === 'TaskCreate')).toBe(false);
        state.currentTurnId = started.currentTurnId;
        const ended = mapClaudeLogMessageToSessionEnvelopes(result('c1', 'Task #1 created successfully: x'), state);
        expect(ended.envelopes.every((e: any) => e.ev.name !== 'TaskCreate')).toBe(true);
        expect(ended.envelopes.some((e: any) => e.ev.name === 'TodoWrite')).toBe(true);
    });
});
