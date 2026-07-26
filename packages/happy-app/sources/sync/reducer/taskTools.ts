/**
 * Claude Code >= 2.1.170 dropped the single `TodoWrite` tool and replaced it
 * with the `TaskCreate` / `TaskUpdate` / `TaskList` family. Nothing errors when
 * that happens — the calls simply carry a different name and report plain text
 * instead of a structured payload — so a client that only knows `TodoWrite`
 * silently stops showing todos.
 *
 * These helpers parse the text back into the existing `TodoItem` shape so the
 * reducer keeps one todo model no matter which engine produced the session.
 */

import { TodoItem } from '../storageTypes';

export const TASK_TOOL_NAMES = ['TaskCreate', 'TaskUpdate', 'TaskList'] as const;

/**
 * A task plus the timestamp of the call that last wrote it. The client loads the
 * newest page first and back-fills older pages, so calls arrive out of order —
 * `at` lets an older page fill gaps without overwriting newer state.
 */
export type FoldedTask = TodoItem & { at?: number };

/**
 * A TaskCreate as it actually arrives: happy-cli does not forward the tool
 * result, so `tool.result` is null and the only real data is the input — which
 * carries the subject but NOT the id. Ids come from TaskUpdate/TaskList. Claude
 * Code numbers tasks 1..N in creation order, so ordering creates by timestamp
 * recovers the mapping.
 */
export type PendingCreate = { at: number; subject: string };

/** Subject of a TaskCreate call, preferring the (usually absent) result. */
export function createSubject(input: unknown, result: unknown): string | null {
    const res = asObject(result);
    const task = asObject(res?.task);
    if (task && typeof task.subject === 'string' && task.subject) {
        return task.subject;
    }
    const text = toResultText(result);
    const parsed = text ? parseTaskCreate(text) : null;
    if (parsed) {
        return parsed.content;
    }
    const inp = asObject(input);
    return typeof inp?.subject === 'string' && inp.subject ? inp.subject : null;
}

/** Insert a create keeping the list ordered by call time, ignoring replays. */
export function addPendingCreate(creates: PendingCreate[], at: number, subject: string): PendingCreate[] {
    if (creates.some((c) => c.at === at && c.subject === subject)) {
        return creates;
    }
    return [...creates, { at, subject }].sort((a, b) => a.at - b.at);
}

/**
 * Fill in subjects for tasks we only know by id.
 *
 * Claude Code numbers tasks 1..N in creation order, so the nth create (by call
 * time) is task n. That mapping is only valid once every create is loaded —
 * the client back-fills older pages, so a partial set would attach the newest
 * subjects to the lowest ids. Guard on having at least as many creates as the
 * highest id any update mentioned; until then leave the placeholders, which the
 * panel hides rather than showing something wrong.
 */
export function applyCreateSubjects(items: FoldedTask[], creates: PendingCreate[]): FoldedTask[] {
    if (creates.length === 0) {
        return items;
    }
    const maxKnownId = items.reduce((max, t) => Math.max(max, Number(t.id ?? 0) || 0), 0);
    if (creates.length < maxKnownId) {
        return items;
    }
    const next = [...items];
    creates.forEach((create, index) => {
        const id = String(index + 1);
        const found = next.findIndex((t) => t.id === id);
        if (found === -1) {
            next.push({ id, content: create.subject, status: 'pending', at: create.at });
            return;
        }
        const existing = { ...next[found] };
        next[found] = existing;
        // Always re-derive, never patch once: pages stream in, so an earlier
        // partial create list may have assigned the wrong subject to this id.
        // Recomputing from the current (sorted) list self-corrects as it grows.
        existing.content = create.subject;
    });
    return sortById(next);
}

const PLACEHOLDER = /^#\d+$/;

/** Drop provenance before publishing to the UI. */
export function stripFoldMeta(items: FoldedTask[]): TodoItem[] {
    return items.map(({ at, ...task }) => task);
}

// "#6 [pending] Phase 5 — open both PRs [blocked by #4, #5]"
const TASK_LIST_LINE = /^#(\d+)\s+\[([a-z_]+)\]\s+(.+)$/;
// "Task #1 created successfully: Phase 0 — Plan + design spec"
const TASK_CREATED = /^Task\s+#(\d+)\s+created successfully:\s*(.+)$/i;

export function isTaskTool(name: string): boolean {
    return (TASK_TOOL_NAMES as readonly string[]).includes(name);
}

/**
 * Tool results reach the reducer as a raw string, a content-block array, or an
 * object wrapping either — normalize to text before parsing.
 */
export function toResultText(result: unknown): string | null {
    if (typeof result === 'string') {
        return result;
    }
    if (Array.isArray(result)) {
        const text = result
            .map((block) => {
                if (typeof block === 'string') return block;
                if (block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string') {
                    return (block as { text: string }).text;
                }
                return '';
            })
            .filter(Boolean)
            .join('\n');
        return text || null;
    }
    if (result && typeof result === 'object') {
        const inner = (result as { content?: unknown; text?: unknown }).content
            ?? (result as { text?: unknown }).text;
        if (typeof inner === 'string') return inner;
        if (Array.isArray(inner)) return toResultText(inner);
    }
    return null;
}

function normalizeStatus(raw: string): TodoItem['status'] {
    return raw === 'completed' || raw === 'in_progress' || raw === 'pending' ? raw : 'pending';
}

export function parseTaskList(text: string): TodoItem[] {
    const items: TodoItem[] = [];
    for (const line of text.split('\n')) {
        const match = TASK_LIST_LINE.exec(line.trim());
        if (!match) {
            continue;
        }
        items.push({ id: match[1], content: match[3].trim(), status: normalizeStatus(match[2]) });
    }
    return items;
}

export function parseTaskCreate(text: string): TodoItem | null {
    const match = TASK_CREATED.exec(text.trim());
    if (!match) {
        return null;
    }
    return { id: match[1], content: match[2].trim(), status: 'pending' };
}

function asObject(value: unknown): Record<string, any> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null;
}

function toId(value: unknown): string | null {
    if (typeof value === 'string' && value) return value;
    if (typeof value === 'number') return String(value);
    return null;
}

/**
 * Task ids are ascending integers, so sorting by id restores creation order no
 * matter which page the calls arrived on. Without this the list would be
 * ordered by arrival, which for back-filled pages is roughly backwards.
 */
function sortById(items: FoldedTask[]): FoldedTask[] {
    return [...items].sort((a, b) => Number(a.id ?? 0) - Number(b.id ?? 0));
}

/** "Phase 5 — open both PRs" + ['4','5'] -> "Phase 5 — open both PRs [blocked by #4, #5]" */
function withBlockedBy(subject: string, blockedBy: unknown): string {
    if (!Array.isArray(blockedBy) || blockedBy.length === 0) {
        return subject;
    }
    return `${subject} [blocked by ${blockedBy.map((b) => `#${b}`).join(', ')}]`;
}

/**
 * Merge one task in, newest-write-wins per field. An older call may fill a
 * missing subject but must not roll back a status a newer call already set.
 */
function upsert(current: FoldedTask[], incoming: FoldedTask, at: number): FoldedTask[] {
    const existing = current.find((t) => t.id === incoming.id);
    if (!existing) {
        return sortById([...current, { ...incoming, at }]);
    }
    const isNewer = at >= (existing.at ?? 0);
    return sortById(current.map((t) => t.id !== incoming.id ? t : {
        ...t,
        // A placeholder subject ("#4") always yields to a real one.
        content: isNewer || /^#\d+$/.test(t.content) ? incoming.content : t.content,
        status: isNewer ? incoming.status : t.status,
        at: Math.max(at, existing.at ?? 0),
    }));
}

/**
 * Fold one Task* call into the running list, returning the next list — or null
 * when the call carries nothing usable, so the caller can leave state untouched.
 *
 * Claude Code reports these results twice: as human-readable text, and as a
 * structured `toolUseResult` that the wire normalizer prefers. So `result` is
 * normally an object, and the text parsers above are the fallback.
 *
 * Every path merges by task id with `at` as the tiebreaker, because the client
 * loads the newest page first and then back-fills older ones — so a TaskList
 * snapshot can arrive *after* creates that postdate it, and an update can arrive
 * before the create that introduced its task. Nothing here may assume order.
 */
export function foldTaskTool(
    current: FoldedTask[],
    toolName: string,
    input: unknown,
    result: unknown,
    at: number = 0,
): FoldedTask[] | null {
    const obj = asObject(result);
    const text = toResultText(result);

    if (toolName === 'TaskList') {
        // structured: { tasks: [{ id, subject, status, blockedBy }] }
        let listed: TodoItem[] = [];
        if (obj && Array.isArray(obj.tasks)) {
            listed = obj.tasks
                .map((raw: any) => {
                    const id = toId(raw?.id);
                    const subject = typeof raw?.subject === 'string' ? raw.subject : null;
                    if (!id || !subject) return null;
                    return {
                        id,
                        content: withBlockedBy(subject, raw?.blockedBy),
                        status: normalizeStatus(String(raw?.status ?? '')),
                    };
                })
                .filter(Boolean) as TodoItem[];
        } else if (text) {
            listed = parseTaskList(text);
        }
        if (listed.length === 0) {
            return null;
        }
        // Merge rather than replace: a TaskList from an older page must not
        // delete tasks created after that snapshot was taken.
        return listed.reduce((acc, task) => upsert(acc, task, at), current);
    }

    if (toolName === 'TaskCreate') {
        // structured: { task: { id, subject } }
        let created: TodoItem | null = null;
        const task = asObject(obj?.task);
        if (task) {
            const id = toId(task.id);
            const subject = typeof task.subject === 'string' ? task.subject : null;
            if (id && subject) {
                created = { id, content: subject, status: normalizeStatus(String(task.status ?? '')) };
            }
        }
        if (!created && text) {
            created = parseTaskCreate(text);
        }
        if (!created) {
            return null;
        }
        // A create is the oldest possible word on a task, so it must never roll
        // back a status an update already applied — hence `at` of 0 for status,
        // while the subject still fills any placeholder.
        return upsert(current, created, Math.min(at, existingAt(current, created.id) ?? at));
    }

    if (toolName === 'TaskUpdate') {
        // structured: { taskId, statusChange: { from, to }, updatedFields }
        const fields = (input ?? {}) as { taskId?: unknown; status?: unknown; subject?: unknown };
        const id = toId(obj?.taskId) ?? toId(fields.taskId);
        if (!id) {
            return null;
        }
        const nextStatus = typeof obj?.statusChange?.to === 'string'
            ? obj.statusChange.to
            : typeof fields.status === 'string' ? fields.status : null;
        const nextSubject = typeof obj?.subject === 'string' && obj.subject
            ? obj.subject
            : typeof fields.subject === 'string' && fields.subject ? fields.subject : null;
        if (!nextStatus && !nextSubject) {
            return null;
        }
        const existing = current.find((t) => t.id === id);
        return upsert(current, {
            id,
            // Placeholder subject when the create has not landed yet.
            content: nextSubject ?? existing?.content ?? `#${id}`,
            status: nextStatus ? normalizeStatus(nextStatus) : existing?.status ?? 'pending',
        }, at);
    }

    return null;
}

function existingAt(current: FoldedTask[], id?: string): number | undefined {
    return current.find((t) => t.id === id)?.at;
}
