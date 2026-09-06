import type { TodoItem } from './storageTypes';

/**
 * Todos are derived locally from the message stream and are not part of the
 * server's session-status payload. Preserve them when that payload omits the
 * field, while still accepting an explicitly supplied list (including empty).
 */
export function resolveSessionTodos(
    incoming: TodoItem[] | undefined,
    existing: TodoItem[] | undefined,
): TodoItem[] | undefined {
    return incoming === undefined ? existing : incoming;
}
