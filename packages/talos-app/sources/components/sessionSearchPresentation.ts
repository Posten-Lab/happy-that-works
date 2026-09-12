import type { ReducerState } from '@/sync/reducer/reducer';

export type HighlightPart = { text: string; highlighted: boolean };

/** Increasing an inverted list's offset moves an older row down the screen. */
export function invertedSearchOffset(offset: number, viewportY: number, viewportHeight: number, targetY: number, targetHeight: number): number {
    const visibleTargetHeight = Math.min(targetHeight, viewportHeight);
    const targetCenter = targetY + visibleTargetHeight / 2;
    const viewportCenter = viewportY + viewportHeight / 2;
    return Math.max(0, offset + viewportCenter - targetCenter);
}

function queryWords(query: string): string[] {
    return [...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])];
}

/** Keep the excerpt around a match, including matches deep inside a long prompt. */
export function searchExcerpt(text: string, query: string, maxLength = 180): string {
    const compact = text.replace(/\s+/g, ' ').trim();
    if (compact.length <= maxLength) return compact;
    const lower = compact.toLocaleLowerCase();
    const positions = queryWords(query).map((word) => lower.indexOf(word)).filter((index) => index >= 0);
    const firstMatch = positions.length > 0 ? Math.min(...positions) : 0;
    const start = Math.max(0, firstMatch - 48);
    const end = Math.min(compact.length, start + maxLength);
    return `${start > 0 ? '…' : ''}${compact.slice(start, end)}${end < compact.length ? '…' : ''}`;
}

export function highlightSearchText(text: string, query: string): HighlightPart[] {
    const words = queryWords(query).sort((a, b) => b.length - a.length);
    if (words.length === 0) return [{ text, highlighted: false }];
    const expression = new RegExp(`(${words.join('|')})`, 'giu');
    return text.split(expression).filter(Boolean).map((part) => ({
        text: part,
        highlighted: words.includes(part.toLocaleLowerCase()),
    }));
}

/** Server/normalized IDs differ from the reducer's allocated display IDs. */
export function resolveSearchMessageId(
    reducerState: Pick<ReducerState, 'messages' | 'messageIds'> | undefined,
    sourceId: string | undefined,
    query: string,
    blockIndex?: number,
): string | undefined {
    if (!sourceId || !reducerState) return undefined;
    const candidates = [...reducerState.messages.values()].filter((message) => (
        message.realID === sourceId && message.text !== null && message.text.trim().length > 0 && !message.isThinking
    ));
    if (blockIndex !== undefined && Number.isInteger(blockIndex) && blockIndex >= 0 && candidates[blockIndex]) return candidates[blockIndex].id;
    const words = queryWords(query);
    const match = candidates.find((message) => words.every((word) => message.text!.toLocaleLowerCase().includes(word)));
    return match?.id ?? candidates[0]?.id ?? reducerState.messageIds.get(sourceId);
}
