import { describe, expect, it, vi } from 'vitest';
import { InvalidateSync } from '@/utils/sync';
import { replayTrackedMessageStreams } from './messageDeliveryReplay';

describe('replayTrackedMessageStreams', () => {
    it('invalidates every tracked stream so durable messages missed in background are replayed', () => {
        const first = { invalidate: vi.fn() } as unknown as InvalidateSync;
        const second = { invalidate: vi.fn() } as unknown as InvalidateSync;

        replayTrackedMessageStreams(new Map([
            ['session-1', first],
            ['session-2', second],
        ]).values());

        expect(first.invalidate).toHaveBeenCalledOnce();
        expect(second.invalidate).toHaveBeenCalledOnce();
    });

    it('does nothing when no session stream has been opened', () => {
        expect(() => replayTrackedMessageStreams([])).not.toThrow();
    });

    it('replays a missed approval handoff on resume without another user message', async () => {
        const durableMessages = [
            { seq: 2, type: 'plan_updated' },
            { seq: 3, type: 'agent_message', text: '<options>Approve</options>' },
            { seq: 4, type: 'task_complete' },
        ];
        const rendered: typeof durableMessages = [];
        let lastSeq = 1;
        const messageSync = new InvalidateSync(async () => {
            const pending = durableMessages.filter((message) => message.seq > lastSeq);
            rendered.push(...pending);
            lastSeq = pending.at(-1)?.seq ?? lastSeq;
        });

        replayTrackedMessageStreams([messageSync]);
        await messageSync.awaitQueue();

        expect(rendered).toEqual(durableMessages);
        expect(lastSeq).toBe(4);
    });
});
