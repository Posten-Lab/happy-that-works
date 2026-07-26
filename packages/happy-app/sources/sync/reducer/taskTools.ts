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

function asObject(value: unknown): Record<string, any> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null;
}

function toId(value: unknown): string | null {
    if (typeof value === 'string' && value) return value;
    if (typeof value === 'number') return String(value);
    return null;
}

/** "Phase 5 — open both PRs" + ['4','5'] -> "Phase 5 — open both PRs [blocked by #4, #5]" */
function withBlockedBy(subject: string, blockedBy: unknown): string {
    if (!Array.isArray(blockedBy) || blockedBy.length === 0) {
        return subject;
    }
    return `${subject} [blocked by ${blockedBy.map((b) => `#${b}`).join(', ')}]`;
}

/**
 * Fold one Task* call into the running list, returning the next list — or null
 * when the call carries nothing usable, so the caller can leave state untouched.
 *
 * Claude Code reports these results twice: as human-readable text, and as a
 * structured `toolUseResult` that the wire normalizer prefers. So `result` is
 * normally an object, and the text parsers above are the fallback.
 *
 * `TaskList` is authoritative: it alone reports every task at once (including
 * blocked-by edges), so it replaces the list wholesale. The other two are
 * incremental, which keeps the checklist live in sessions that never call it.
 */
export function foldTaskTool(
    current: TodoItem[],
    toolName: string,
    input: unknown,
    result: unknown,
): TodoItem[] | null {
    const obj = asObject(result);
    const text = toResultText(result);

    if (toolName === 'TaskList') {
        // structured: { tasks: [{ id, subject, status, blockedBy }] }
        if (obj && Array.isArray(obj.tasks)) {
            const items = obj.tasks
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
            return items.length > 0 ? items : null;
        }
        if (!text) return null;
        const parsed = parseTaskList(text);
        return parsed.length > 0 ? parsed : null;
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
        // A retried create must not duplicate the row it already produced.
        if (current.some((t) => t.id === created!.id)) {
            return current.map((t) => (t.id === created!.id ? { ...t, content: created!.content } : t));
        }
        return [...current, created];
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

        let matched = false;
        const next = current.map((task) => {
            if (task.id !== id) {
                return task;
            }
            matched = true;
            return {
                ...task,
                status: nextStatus ? normalizeStatus(nextStatus) : task.status,
                content: nextSubject ?? task.content,
            };
        });
        // An update for a task we never saw created (e.g. a resumed session)
        // is dropped; the next TaskList call repopulates the whole list.
        return matched ? next : null;
    }

    return null;
}
