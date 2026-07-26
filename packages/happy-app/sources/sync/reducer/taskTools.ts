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

/**
 * Fold one Task* call into the running list, returning the next list — or null
 * when the call carries nothing usable, so the caller can leave state untouched.
 *
 * `TaskList` is authoritative: it is the only call that reports every task at
 * once (including blocked-by edges), so it replaces the list wholesale. The
 * other two are incremental, which keeps the panel live for sessions that never
 * call `TaskList`.
 */
export function foldTaskTool(
    current: TodoItem[],
    toolName: string,
    input: unknown,
    resultText: string | null,
): TodoItem[] | null {
    if (toolName === 'TaskList') {
        if (!resultText) {
            return null;
        }
        const parsed = parseTaskList(resultText);
        return parsed.length > 0 ? parsed : null;
    }

    if (toolName === 'TaskCreate') {
        if (!resultText) {
            return null;
        }
        const created = parseTaskCreate(resultText);
        if (!created) {
            return null;
        }
        // A retried create must not duplicate the row it already produced.
        if (current.some((task) => task.id === created.id)) {
            return current.map((task) => (task.id === created.id ? { ...task, content: created.content } : task));
        }
        return [...current, created];
    }

    if (toolName === 'TaskUpdate') {
        const fields = (input ?? {}) as { taskId?: unknown; status?: unknown; subject?: unknown };
        const id = typeof fields.taskId === 'string'
            ? fields.taskId
            : typeof fields.taskId === 'number' ? String(fields.taskId) : null;
        if (!id) {
            return null;
        }
        let matched = false;
        const next = current.map((task) => {
            if (task.id !== id) {
                return task;
            }
            matched = true;
            return {
                ...task,
                status: typeof fields.status === 'string' ? normalizeStatus(fields.status) : task.status,
                content: typeof fields.subject === 'string' && fields.subject ? fields.subject : task.content,
            };
        });
        // An update for a task we never saw created (e.g. a resumed session)
        // is dropped; the next TaskList call repopulates the whole list.
        return matched ? next : null;
    }

    return null;
}
