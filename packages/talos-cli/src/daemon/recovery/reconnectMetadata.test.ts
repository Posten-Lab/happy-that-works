import { expect, it } from 'vitest';
import { reconnectMetadata } from './reconnectMetadata';
import type { Metadata } from '@/api/types';

it('preserves title/provider metadata while refreshing process identity and clearing archive state', () => {
    const stored = { summary: { text: 'Keep my title', updatedAt: 1 }, codexThreadId: 'thread', hostPid: 1,
        lifecycleState: 'archived', archivedBy: 'user', providerPrivate: { retained: true } };
    const current = { path: '/work', hostPid: 2, codexThreadId: undefined } as Metadata;
    expect(reconnectMetadata(current, Buffer.from(JSON.stringify(stored)).toString('base64'))).toMatchObject({
        summary: stored.summary, codexThreadId: 'thread', hostPid: 2, lifecycleState: 'running', archivedBy: undefined,
        providerPrivate: { retained: true },
    });
});
