import type { ACPMessageData } from '@/api/apiSession';
import type { PermissionResult } from '@/utils/BasePermissionHandler';

export type JsonObject = Record<string, unknown>;
export function object(value: unknown): JsonObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}
export function text(value: unknown): string { return typeof value === 'string' ? value : ''; }

export type MuseMessage = { id: string; user?: string; data?: ACPMessageData };

/** Full item revisions are authoritative; never append a snapshot to streamed deltas. */
export class MuseMessageMapper {
    private emitted = new Set<string>();
    private submittedCommands = new Set<string>();

    submitted(commandId: string) { this.submittedCommands.add(commandId); }

    map(raw: unknown): MuseMessage[] {
        const item = object(raw);
        const id = text(item.itemId);
        if (!id) return [];
        const result: MuseMessage[] = [];
        const emit = (part: string, message: Omit<MuseMessage, 'id'>) => {
            const key = `muse:${id}:${part}`;
            if (this.emitted.has(key)) return;
            this.emitted.add(key);
            result.push({ id: key, ...message });
        };
        const completed = item.status !== 'inProgress';
        if (item.kind === 'toolCall') {
            let input: unknown = item.args;
            try { input = JSON.parse(text(item.args)); } catch { /* Preserve malformed provider input. */ }
            emit('start', { data: { type: 'tool-call', callId: id, id, name: text(item.toolName) || 'Muse tool', input } });
            if (completed) emit('result', { data: { type: 'tool-result', callId: id, id,
                output: item.visibleOutput ?? item.failureReason ?? item.result ?? '', isError: item.status !== 'completed' } });
        } else if (completed && item.kind === 'userMessage') {
            if (!item.retracted && !this.submittedCommands.has(text(item.commandId)) && text(item.text)) {
                emit('user', { user: text(item.displayText) || text(item.text) });
            }
        } else if (completed && item.kind === 'agentMessage') {
            if (text(item.text)) emit('text', { data: { type: 'message', message: text(item.text) } });
        } else if (completed && item.kind === 'reasoning') {
            const summary = Array.isArray(item.summary) ? item.summary.filter(v => typeof v === 'string').join('\n') : '';
            if (summary) emit('summary', { data: { type: 'reasoning', message: summary } });
        } else if (completed && !['userMessage', 'reasoning'].includes(text(item.kind))) {
            const message = text(item.fallbackText) || text(item.visibleOutput) || text(item.objective) || text(item.message);
            if (message) emit('other', { data: { type: 'message', message: `${text(item.kind)}: ${message}` } });
        }
        return result;
    }
}

/** Only select choices offered for this exact requirement. Never synthesize a policy. */
export function approvalChoice(request: JsonObject, decision: PermissionResult['decision']): string | null {
    const choices = Array.isArray(request.availableChoices) ? request.availableChoices.map(object) : [];
    const match = (kind: string, scope?: string) => choices.find(c => c.decision === kind && (!scope || c.scope === scope));
    const choice = decision === 'approved_for_session'
        ? match('approvedForSession', 'session') ?? match('approved', 'once')
        : decision === 'approved' ? match('approved', 'once')
        : decision === 'denied' ? match('denied') ?? match('abort') : match('abort') ?? match('denied');
    return choice ? text(choice.choiceId) || null : null;
}

export const musePermissionModes = [
    { id: 'default', name: 'Ask before untrusted actions', native: 'promptUnmatched' },
    { id: 'safe-yolo', name: 'Ask when Muse requests approval', native: 'onRequest' },
] as const;
