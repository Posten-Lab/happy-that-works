import { createId } from '@paralleldrive/cuid2';
import type { RawJSONLines } from '@/claude/types';
import {
    createEnvelope,
    type SessionEnvelope,
    type SessionTurnEndStatus,
} from '@slopus/happy-wire';

export type ClaudeSessionProtocolState = {
    currentTurnId: string | null;
    uuidToProviderSubagent?: Map<string, string>;
    taskPromptToSubagents?: Map<string, string[]>;
    providerSubagentToSessionSubagent?: Map<string, string>;
    subagentTitles?: Map<string, string>;
    bufferedSubagentMessages?: Map<string, RawJSONLines[]>;
    hiddenParentToolCalls?: Set<string>;
    startedSubagents?: Set<string>;
    activeSubagents?: Set<string>;
    // Claude's TaskCreate/TaskUpdate/TaskList calls each report only their own
    // task. Folded here — where the stream is chronological and ids are exact —
    // and republished as a whole-list TodoWrite so clients need no task logic.
    taskList?: ClaudeTask[];
    pendingTaskCalls?: Map<string, { name: string; input: Record<string, unknown> }>;
};

export type ClaudeTask = { id: string; content: string; status: 'pending' | 'in_progress' | 'completed' };

type ClaudeMapperResult = {
    currentTurnId: string | null;
    envelopes: SessionEnvelope[];
};

function isSubagentTool(name: string): boolean {
    return name === 'Task' || name === 'Agent';
}

function shouldHideParentToolCall(name: string): boolean {
    return name === 'Task';
}

function pickProviderSubagent(message: RawJSONLines): string | undefined {
    const raw = message as { parent_tool_use_id?: unknown; parentToolUseId?: unknown };
    if (typeof raw.parent_tool_use_id === 'string' && raw.parent_tool_use_id.length > 0) {
        return raw.parent_tool_use_id;
    }
    if (typeof raw.parentToolUseId === 'string' && raw.parentToolUseId.length > 0) {
        return raw.parentToolUseId;
    }
    return undefined;
}

function getUuidToProviderSubagent(state: ClaudeSessionProtocolState): Map<string, string> {
    if (!state.uuidToProviderSubagent) {
        state.uuidToProviderSubagent = new Map<string, string>();
    }
    return state.uuidToProviderSubagent;
}

function getTaskPromptToSubagents(state: ClaudeSessionProtocolState): Map<string, string[]> {
    if (!state.taskPromptToSubagents) {
        state.taskPromptToSubagents = new Map<string, string[]>();
    }
    return state.taskPromptToSubagents;
}

function getProviderSubagentToSessionSubagent(state: ClaudeSessionProtocolState): Map<string, string> {
    if (!state.providerSubagentToSessionSubagent) {
        state.providerSubagentToSessionSubagent = new Map<string, string>();
    }
    return state.providerSubagentToSessionSubagent;
}

function getSessionSubagentIdForProviderSubagent(
    state: ClaudeSessionProtocolState,
    providerSubagent: string,
): string | undefined {
    return getProviderSubagentToSessionSubagent(state).get(providerSubagent);
}

function ensureSessionSubagentIdForProviderSubagent(
    state: ClaudeSessionProtocolState,
    providerSubagent: string,
): string {
    const existing = getSessionSubagentIdForProviderSubagent(state, providerSubagent);
    if (existing) {
        return existing;
    }

    const created = createId();
    getProviderSubagentToSessionSubagent(state).set(providerSubagent, created);
    return created;
}

function getSubagentTitles(state: ClaudeSessionProtocolState): Map<string, string> {
    if (!state.subagentTitles) {
        state.subagentTitles = new Map<string, string>();
    }
    return state.subagentTitles;
}

function getBufferedSubagentMessages(state: ClaudeSessionProtocolState): Map<string, RawJSONLines[]> {
    if (!state.bufferedSubagentMessages) {
        state.bufferedSubagentMessages = new Map<string, RawJSONLines[]>();
    }
    return state.bufferedSubagentMessages;
}

function getHiddenParentToolCalls(state: ClaudeSessionProtocolState): Set<string> {
    if (!state.hiddenParentToolCalls) {
        state.hiddenParentToolCalls = new Set<string>();
    }
    return state.hiddenParentToolCalls;
}

function bufferSubagentMessage(state: ClaudeSessionProtocolState, subagent: string, message: RawJSONLines): void {
    const buffer = getBufferedSubagentMessages(state);
    const queue = buffer.get(subagent) ?? [];
    queue.push(message);
    buffer.set(subagent, queue);
}

function consumeBufferedSubagentMessages(state: ClaudeSessionProtocolState, subagent: string): RawJSONLines[] {
    const buffer = getBufferedSubagentMessages(state);
    const queue = buffer.get(subagent) ?? [];
    buffer.delete(subagent);
    return queue;
}

function getStartedSubagents(state: ClaudeSessionProtocolState): Set<string> {
    if (!state.startedSubagents) {
        state.startedSubagents = new Set<string>();
    }
    return state.startedSubagents;
}

function getActiveSubagents(state: ClaudeSessionProtocolState): Set<string> {
    if (!state.activeSubagents) {
        state.activeSubagents = new Set<string>();
    }
    return state.activeSubagents;
}

function pickUuid(message: RawJSONLines): string | undefined {
    const raw = message as { uuid?: unknown };
    if (typeof raw.uuid === 'string' && raw.uuid.length > 0) {
        return raw.uuid;
    }
    return undefined;
}

function pickParentUuid(message: RawJSONLines): string | undefined {
    const raw = message as { parentUuid?: unknown; parentUUID?: unknown };
    if (typeof raw.parentUuid === 'string' && raw.parentUuid.length > 0) {
        return raw.parentUuid;
    }
    if (typeof raw.parentUUID === 'string' && raw.parentUUID.length > 0) {
        return raw.parentUUID;
    }
    return undefined;
}

function isSidechainMessage(message: RawJSONLines): boolean {
    const raw = message as { isSidechain?: unknown };
    return raw.isSidechain === true;
}

function normalizePrompt(prompt: string): string {
    return prompt.trim();
}

function queueTaskPromptSubagent(state: ClaudeSessionProtocolState, prompt: string, subagent: string): void {
    const normalized = normalizePrompt(prompt);
    if (normalized.length === 0) {
        return;
    }

    const promptMap = getTaskPromptToSubagents(state);
    const queue = promptMap.get(normalized) ?? [];
    if (!queue.includes(subagent)) {
        queue.push(subagent);
    }
    promptMap.set(normalized, queue);
}

function consumeTaskPromptSubagent(state: ClaudeSessionProtocolState, prompt: string): string | undefined {
    const normalized = normalizePrompt(prompt);
    if (normalized.length === 0) {
        return undefined;
    }

    const promptMap = getTaskPromptToSubagents(state);
    const queue = promptMap.get(normalized);
    if (!queue || queue.length === 0) {
        return undefined;
    }

    const subagent = queue.shift();
    if (queue.length === 0) {
        promptMap.delete(normalized);
    }
    return subagent;
}

function consumeSinglePendingTaskSubagent(state: ClaudeSessionProtocolState): string | undefined {
    const promptMap = getTaskPromptToSubagents(state);
    let candidateKey: string | null = null;
    let candidateSubagent: string | null = null;

    for (const [prompt, queue] of promptMap.entries()) {
        if (queue.length === 0) {
            continue;
        }

        if (candidateKey !== null) {
            return undefined;
        }

        candidateKey = prompt;
        candidateSubagent = queue[0] ?? null;
    }

    if (!candidateKey || !candidateSubagent) {
        return undefined;
    }

    const queue = promptMap.get(candidateKey);
    if (!queue || queue.length === 0) {
        return undefined;
    }

    queue.shift();
    if (queue.length === 0) {
        promptMap.delete(candidateKey);
    }

    return candidateSubagent;
}

function pickSidechainRootPrompt(message: RawJSONLines): string | undefined {
    if (message.type !== 'user') {
        return undefined;
    }

    if (typeof message.message?.content === 'string') {
        const normalized = normalizePrompt(message.message.content);
        return normalized.length > 0 ? normalized : undefined;
    }

    return undefined;
}

function resolveProviderSubagent(message: RawJSONLines, state: ClaudeSessionProtocolState): string | undefined {
    const explicitSubagent = pickProviderSubagent(message);
    if (explicitSubagent) {
        return explicitSubagent;
    }

    const parentUuid = pickParentUuid(message);
    if (parentUuid) {
        const inheritedSubagent = getUuidToProviderSubagent(state).get(parentUuid);
        if (inheritedSubagent) {
            return inheritedSubagent;
        }
    }

    if (!isSidechainMessage(message)) {
        return undefined;
    }

    const prompt = pickSidechainRootPrompt(message);
    if (prompt) {
        const matchedSubagent = consumeTaskPromptSubagent(state, prompt);
        if (matchedSubagent) {
            return matchedSubagent;
        }
    }

    if (!parentUuid) {
        return consumeSinglePendingTaskSubagent(state);
    }

    return undefined;
}

function rememberSubagentForMessage(message: RawJSONLines, state: ClaudeSessionProtocolState, providerSubagent: string | undefined): void {
    if (!providerSubagent) {
        return;
    }

    const uuid = pickUuid(message);
    if (!uuid) {
        return;
    }

    getUuidToProviderSubagent(state).set(uuid, providerSubagent);
}

function pickTaskPrompt(input: unknown): string | undefined {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return undefined;
    }

    const prompt = (input as { prompt?: unknown }).prompt;
    if (typeof prompt !== 'string') {
        return undefined;
    }

    const normalized = normalizePrompt(prompt);
    return normalized.length > 0 ? normalized : undefined;
}

function pickTaskTitle(input: unknown): string | undefined {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return undefined;
    }

    const candidateKeys = ['description', 'title', 'subagent_type'];
    for (const key of candidateKeys) {
        const value = (input as Record<string, unknown>)[key];
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }
    }

    return undefined;
}

function setSubagentTitle(state: ClaudeSessionProtocolState, subagent: string, title: string | undefined): void {
    if (!title || title.trim().length === 0) {
        return;
    }
    getSubagentTitles(state).set(subagent, title.trim());
}

function maybeEmitSubagentStart(
    state: ClaudeSessionProtocolState,
    turn: string,
    subagent: string | undefined,
    envelopes: SessionEnvelope[],
): void {
    if (!subagent) {
        return;
    }

    const started = getStartedSubagents(state);
    if (started.has(subagent)) {
        return;
    }

    const title = getSubagentTitles(state).get(subagent);
    envelopes.push(createEnvelope('agent', {
        t: 'start',
        ...(title ? { title } : {}),
    }, { turn, subagent }));
    started.add(subagent);
    getActiveSubagents(state).add(subagent);
}

function maybeEmitSubagentStop(
    state: ClaudeSessionProtocolState,
    turn: string,
    subagent: string,
    envelopes: SessionEnvelope[],
): void {
    const active = getActiveSubagents(state);
    if (!active.has(subagent)) {
        return;
    }

    envelopes.push(createEnvelope('agent', { t: 'stop' }, { turn, subagent }));
    active.delete(subagent);
}

function clearSubagentTracking(state: ClaudeSessionProtocolState): void {
    getUuidToProviderSubagent(state).clear();
    getTaskPromptToSubagents(state).clear();
    getProviderSubagentToSessionSubagent(state).clear();
    getSubagentTitles(state).clear();
    getBufferedSubagentMessages(state).clear();
    getHiddenParentToolCalls(state).clear();
    getStartedSubagents(state).clear();
    getActiveSubagents(state).clear();
}

function ensureTurn(state: ClaudeSessionProtocolState, envelopes: SessionEnvelope[]): string {
    if (state.currentTurnId) {
        return state.currentTurnId;
    }

    const turnId = createId();
    envelopes.push(createEnvelope('agent', { t: 'turn-start' }, { turn: turnId }));
    state.currentTurnId = turnId;
    return turnId;
}

function closeTurn(
    state: ClaudeSessionProtocolState,
    status: SessionTurnEndStatus,
    envelopes: SessionEnvelope[],
): void {
    if (!state.currentTurnId) {
        return;
    }

    envelopes.push(createEnvelope('agent', { t: 'turn-end', status }, { turn: state.currentTurnId }));
    state.currentTurnId = null;
    clearSubagentTracking(state);
}

function toolTitle(name: string, input: unknown): string {
    if (input && typeof input === 'object') {
        const description = (input as { description?: unknown }).description;
        if (typeof description === 'string' && description.trim().length > 0) {
            return description.length > 80 ? `${description.slice(0, 77)}...` : description;
        }
    }
    return `${name} call`;
}

function toToolArgs(input: unknown): Record<string, unknown> {
    if (input && typeof input === 'object' && !Array.isArray(input)) {
        return input as Record<string, unknown>;
    }
    if (input === undefined) {
        return {};
    }
    return { input };
}

/**
 * The output to publish for a finished tool call.
 *
 * Claude Code emits the result twice: `toolUseResult` (structured, and the only
 * place some tools report ids) and the human-readable `content` block. Prefer
 * the structured one, fall back to the content, and return undefined when the
 * tool genuinely produced nothing so the field stays absent on the wire.
 */
function toolResultPayload(message: any, block: any): unknown {
    const structured = message?.toolUseResult;
    if (structured !== undefined && structured !== null) {
        return structured;
    }
    const content = block?.content;
    if (typeof content === 'string') {
        return content.length > 0 ? content : undefined;
    }
    if (Array.isArray(content)) {
        const text = content
            .map((c: any) => (typeof c?.text === 'string' ? c.text : ''))
            .filter(Boolean)
            .join('\n');
        return text.length > 0 ? text : undefined;
    }
    return content ?? undefined;
}


const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskList']);
const TASK_CREATED_TEXT = /^Task\s+#(\d+)\s+created successfully:\s*(.+)$/i;
const TASK_LIST_LINE = /^#(\d+)\s+\[([a-z_]+)\]\s+(.+)$/;

function taskStatus(raw: unknown): ClaudeTask['status'] {
    return raw === 'completed' || raw === 'in_progress' || raw === 'pending' ? raw : 'pending';
}

function getTaskList(state: ClaudeSessionProtocolState): ClaudeTask[] {
    if (!state.taskList) {
        state.taskList = [];
    }
    return state.taskList;
}

function getPendingTaskCalls(state: ClaudeSessionProtocolState): Map<string, { name: string; input: Record<string, unknown> }> {
    if (!state.pendingTaskCalls) {
        state.pendingTaskCalls = new Map();
    }
    return state.pendingTaskCalls;
}

function upsertTask(list: ClaudeTask[], task: ClaudeTask): void {
    const existing = list.find((t) => t.id === task.id);
    if (existing) {
        existing.content = task.content || existing.content;
        existing.status = task.status;
        return;
    }
    list.push(task);
    list.sort((a, b) => Number(a.id) - Number(b.id));
}

/** Text form of a tool result, whatever shape it arrived in. */
function resultText(message: any, block: any): string {
    const c = block?.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map((x: any) => (typeof x?.text === 'string' ? x.text : '')).filter(Boolean).join('\n');
    return '';
}

/**
 * Fold one completed Task* call into the running list.
 *
 * The CLI sees calls in order and gets the real ids (from the structured
 * `toolUseResult` when present, otherwise from the result text), so this is
 * exact — no positional guessing, no reconciling out-of-order pages.
 * Returns true when the list changed.
 */
function foldClaudeTaskCall(
    state: ClaudeSessionProtocolState,
    call: { name: string; input: Record<string, unknown> },
    message: any,
    block: any,
): boolean {
    const list = getTaskList(state);
    const structured = message?.toolUseResult;
    const text = resultText(message, block);

    if (call.name === 'TaskCreate') {
        const fromStructured = structured?.task;
        const id = fromStructured?.id != null ? String(fromStructured.id) : TASK_CREATED_TEXT.exec(text.trim())?.[1];
        const subject = typeof fromStructured?.subject === 'string'
            ? fromStructured.subject
            : TASK_CREATED_TEXT.exec(text.trim())?.[2] ?? (typeof call.input.subject === 'string' ? call.input.subject : null);
        if (!id || !subject) return false;
        upsertTask(list, { id, content: subject, status: 'pending' });
        return true;
    }

    if (call.name === 'TaskUpdate') {
        const id = structured?.taskId != null ? String(structured.taskId)
            : call.input.taskId != null ? String(call.input.taskId) : null;
        if (!id) return false;
        const status = typeof structured?.statusChange?.to === 'string'
            ? structured.statusChange.to
            : typeof call.input.status === 'string' ? call.input.status : null;
        const subject = typeof call.input.subject === 'string' ? call.input.subject : null;
        const existing = list.find((t) => t.id === id);
        upsertTask(list, {
            id,
            content: subject ?? existing?.content ?? `#${id}`,
            status: status ? taskStatus(status) : existing?.status ?? 'pending',
        });
        return true;
    }

    if (call.name === 'TaskList') {
        const tasks = Array.isArray(structured?.tasks) ? structured.tasks : null;
        if (tasks) {
            for (const raw of tasks) {
                const id = raw?.id != null ? String(raw.id) : null;
                const subject = typeof raw?.subject === 'string' ? raw.subject : null;
                if (!id || !subject) continue;
                const blockedBy = Array.isArray(raw.blockedBy) && raw.blockedBy.length > 0
                    ? ` [blocked by ${raw.blockedBy.map((b: unknown) => `#${b}`).join(', ')}]`
                    : '';
                upsertTask(list, { id, content: subject + blockedBy, status: taskStatus(raw.status) });
            }
            return tasks.length > 0;
        }
        let changed = false;
        for (const line of text.split('\n')) {
            const m = TASK_LIST_LINE.exec(line.trim());
            if (!m) continue;
            upsertTask(list, { id: m[1], content: m[3].trim(), status: taskStatus(m[2]) });
            changed = true;
        }
        return changed;
    }

    return false;
}

/**
 * Rebuild the task list from an existing transcript.
 *
 * A restarted session starts with an empty fold, so the next TaskUpdate would
 * otherwise republish a list containing only the task it touched. Replaying the
 * transcript's Task* calls here recovers the real list, and returns a single
 * TodoWrite so the client shows it immediately rather than waiting for the
 * agent to touch tasks again.
 *
 * Only Task* calls are folded — nothing else is emitted, so this cannot
 * duplicate transcript content that the client already has.
 */
export function seedClaudeTaskList(
    state: ClaudeSessionProtocolState,
    messages: RawJSONLines[],
): SessionEnvelope[] {
    const pending = new Map<string, { name: string; input: Record<string, unknown> }>();
    let folded = false;

    for (const message of messages) {
        const blocks = (message as any)?.message?.content;
        if (!Array.isArray(blocks)) continue;
        for (const block of blocks) {
            if (block?.type === 'tool_use' && typeof block.name === 'string' && TASK_TOOLS.has(block.name)) {
                pending.set(String(block.id), { name: block.name, input: (block.input ?? {}) as Record<string, unknown> });
                continue;
            }
            if (block?.type === 'tool_result' && typeof block.tool_use_id === 'string') {
                const call = pending.get(block.tool_use_id);
                if (!call) continue;
                pending.delete(block.tool_use_id);
                if (foldClaudeTaskCall(state, call, message, block)) {
                    folded = true;
                }
            }
        }
    }

    const list = getTaskList(state);
    if (!folded || list.length === 0) {
        return [];
    }

    const todos = list.map((t) => ({ content: t.content, status: t.status }));
    const call = createId();
    const turnId = state.currentTurnId ?? undefined;
    return [
        createEnvelope('agent', {
            t: 'tool-call-start', call, name: 'TodoWrite', title: 'Todo List', description: '', args: { todos },
        }, turnId ? { turn: turnId } : {}),
        createEnvelope('agent', {
            t: 'tool-call-end', call, result: { oldTodos: [], newTodos: todos },
        }, turnId ? { turn: turnId } : {}),
    ];
}

export function closeClaudeTurnWithStatus(
    state: ClaudeSessionProtocolState,
    status: SessionTurnEndStatus,
): ClaudeMapperResult {
    const envelopes: SessionEnvelope[] = [];
    closeTurn(state, status, envelopes);
    return {
        currentTurnId: state.currentTurnId,
        envelopes,
    };
}

export function mapClaudeLogMessageToSessionEnvelopes(
    message: RawJSONLines,
    state: ClaudeSessionProtocolState,
): ClaudeMapperResult {
    return mapClaudeLogMessageToSessionEnvelopesInternal(message, state);
}

function mapClaudeLogMessageToSessionEnvelopesInternal(
    message: RawJSONLines,
    state: ClaudeSessionProtocolState,
): ClaudeMapperResult {
    const envelopes: SessionEnvelope[] = [];
    const claudeUuid = pickUuid(message);
    const providerSubagent = resolveProviderSubagent(message, state);
    const subagent = providerSubagent
        ? getSessionSubagentIdForProviderSubagent(state, providerSubagent)
        : undefined;
    rememberSubagentForMessage(message, state, providerSubagent);

    if (providerSubagent && !subagent) {
        bufferSubagentMessage(state, providerSubagent, message);
        return {
            currentTurnId: state.currentTurnId,
            envelopes: [],
        };
    }

    if (message.type === 'summary') {
        return {
            currentTurnId: state.currentTurnId,
            envelopes,
        };
    }

    if (message.type === 'system') {
        return {
            currentTurnId: state.currentTurnId,
            envelopes,
        };
    }

    if ((message as any).isCompactSummary) {
        return {
            currentTurnId: state.currentTurnId,
            envelopes,
        };
    }

    if (message.type === 'assistant') {
        const turnId = ensureTurn(state, envelopes);
        maybeEmitSubagentStart(state, turnId, subagent, envelopes);
        const blocks = Array.isArray(message.message?.content) ? message.message.content : [];

        for (const block of blocks) {
            if (block.type === 'text' && typeof block.text === 'string') {
                envelopes.push(createEnvelope('agent', { t: 'text', text: block.text }, { turn: turnId, subagent, claudeUuid }));
                continue;
            }

            if (block.type === 'thinking' && typeof block.thinking === 'string') {
                envelopes.push(createEnvelope('agent', { t: 'text', text: block.thinking, thinking: true }, { turn: turnId, subagent, claudeUuid }));
                continue;
            }

            if (block.type === 'tool_use') {
                const call = typeof block.id === 'string' && block.id.length > 0 ? block.id : createId();
                const name = typeof block.name === 'string' && block.name.length > 0 ? block.name : 'unknown';
                const baseArgs = toToolArgs(block.input);
                const title = toolTitle(name, block.input);
                const sessionSubagentForCall = ensureSessionSubagentIdForProviderSubagent(state, call);
                if (isSubagentTool(name)) {
                    const prompt = pickTaskPrompt(block.input);
                    if (prompt) {
                        queueTaskPromptSubagent(state, prompt, call);
                    }
                    setSubagentTitle(state, sessionSubagentForCall, pickTaskTitle(block.input) ?? prompt);
                }
                if (shouldHideParentToolCall(name)) {
                    getHiddenParentToolCalls(state).add(call);

                    const buffered = consumeBufferedSubagentMessages(state, call);
                    for (const bufferedMessage of buffered) {
                        const replay = mapClaudeLogMessageToSessionEnvelopesInternal(bufferedMessage, state);
                        envelopes.push(...replay.envelopes);
                    }
                    continue;
                }
                const args = isSubagentTool(name)
                    ? { ...baseArgs, sessionSubagent: sessionSubagentForCall }
                    : baseArgs;

                if (TASK_TOOLS.has(name)) {
                    // Remember it so the result can be folded; the call itself is
                    // not published — the folded TodoWrite below replaces it.
                    getPendingTaskCalls(state).set(call, { name, input: (baseArgs ?? {}) as Record<string, unknown> });
                    continue;
                }

                envelopes.push(createEnvelope('agent', {
                    t: 'tool-call-start',
                    call,
                    name,
                    title,
                    description: title,
                    args,
                }, { turn: turnId, subagent }));
                const buffered = consumeBufferedSubagentMessages(state, call);
                for (const bufferedMessage of buffered) {
                    const replay = mapClaudeLogMessageToSessionEnvelopesInternal(bufferedMessage, state);
                    envelopes.push(...replay.envelopes);
                }
            }
        }

        return {
            currentTurnId: state.currentTurnId,
            envelopes,
        };
    }

    if (message.type === 'user') {
        // SDK-injected synthetic user messages (e.g. the Skill tool feeds
        // the skill prompt back to Claude as a 'user' message with
        // isMeta=true so the model sees it but the human shouldn't).
        // Without this skip the prompt body — easily 10–20k characters —
        // gets emitted as an agent-text envelope and lands in the chat as
        // a wall of text.
        if (message.isMeta) {
            return {
                currentTurnId: state.currentTurnId,
                envelopes,
            };
        }
        if (typeof message.message.content === 'string') {
            if (message.isSidechain) {
                const turnId = ensureTurn(state, envelopes);
                maybeEmitSubagentStart(state, turnId, subagent, envelopes);
                envelopes.push(createEnvelope('agent', { t: 'text', text: message.message.content }, { turn: turnId, subagent, claudeUuid }));
            } else {
                closeTurn(state, 'completed', envelopes);
                envelopes.push(createEnvelope('user', { t: 'text', text: message.message.content }, { claudeUuid }));
            }

            return {
                currentTurnId: state.currentTurnId,
                envelopes,
            };
        }

        const blocks = Array.isArray(message.message.content) ? message.message.content : [];
        if (blocks.length === 0) {
            return {
                currentTurnId: state.currentTurnId,
                envelopes,
            };
        }

        const hasToolResult = blocks.some((block) => {
            return block?.type === 'tool_result';
        });
        if (!message.isSidechain && !hasToolResult) {
            closeTurn(state, 'completed', envelopes);
            for (const block of blocks) {
                if (block.type === 'text' && typeof block.text === 'string' && block.text.trim().length > 0) {
                    envelopes.push(createEnvelope('user', { t: 'text', text: block.text }, { claudeUuid }));
                }
            }

            return {
                currentTurnId: state.currentTurnId,
                envelopes,
            };
        }

        const turnId = ensureTurn(state, envelopes);
        if (message.isSidechain) {
            maybeEmitSubagentStart(state, turnId, subagent, envelopes);
        }
        for (const block of blocks) {
            if (block.type === 'tool_result' && typeof block.tool_use_id === 'string' && block.tool_use_id.length > 0) {
                const sessionSubagentForToolResult = getSessionSubagentIdForProviderSubagent(state, block.tool_use_id);
                if (!message.isSidechain) {
                    if (getHiddenParentToolCalls(state).has(block.tool_use_id)) {
                        if (sessionSubagentForToolResult) {
                            maybeEmitSubagentStop(state, turnId, sessionSubagentForToolResult, envelopes);
                        }
                        getHiddenParentToolCalls(state).delete(block.tool_use_id);
                        continue;
                    }
                    if (sessionSubagentForToolResult) {
                        maybeEmitSubagentStop(state, turnId, sessionSubagentForToolResult, envelopes);
                    }
                }
                const pendingTask = getPendingTaskCalls(state).get(block.tool_use_id);
                if (pendingTask) {
                    getPendingTaskCalls(state).delete(block.tool_use_id);
                    const changed = foldClaudeTaskCall(state, pendingTask, message, block);
                    const list = getTaskList(state);
                    if (changed && list.length > 0) {
                        const todos = list.map((t) => ({ content: t.content, status: t.status }));
                        const todoCall = createId();
                        envelopes.push(createEnvelope('agent', {
                            t: 'tool-call-start',
                            call: todoCall,
                            name: 'TodoWrite',
                            title: 'Todo List',
                            description: '',
                            args: { todos },
                        }, { turn: turnId, subagent }));
                        envelopes.push(createEnvelope('agent', {
                            t: 'tool-call-end',
                            call: todoCall,
                            result: { oldTodos: [], newTodos: todos },
                        }, { turn: turnId, subagent }));
                    }
                    continue;
                }

                envelopes.push(createEnvelope('agent', {
                    t: 'tool-call-end',
                    call: block.tool_use_id,
                    // Forward the tool's output. Claude Code also writes a
                    // structured `toolUseResult` alongside the human-readable
                    // content; prefer it, since some tools (TaskCreate) report
                    // the id only there.
                    ...(toolResultPayload(message, block) !== undefined
                        ? { result: toolResultPayload(message, block) }
                        : {}),
                    ...(block.is_error === true ? { isError: true } : {}),
                }, { turn: turnId, subagent }));
                continue;
            }

            if (block.type === 'text' && typeof block.text === 'string' && block.text.trim().length > 0) {
                envelopes.push(createEnvelope('agent', { t: 'text', text: block.text }, { turn: turnId, subagent, claudeUuid }));
            }
        }

        return {
            currentTurnId: state.currentTurnId,
            envelopes,
        };
    }

    return {
        currentTurnId: state.currentTurnId,
        envelopes,
    };
}
