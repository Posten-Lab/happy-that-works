import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    request: vi.fn(), emitWithAck: vi.fn(),
    decryptRaw: vi.fn(async (value: string) => JSON.parse(value)),
    encryptRaw: vi.fn(async (value: unknown) => JSON.stringify(value)),
}));
vi.mock('./apiSocket', () => ({ apiSocket: { request: mocks.request, emitWithAck: mocks.emitWithAck } }));
vi.mock('./sync', () => ({ sync: { encryption: { getSessionEncryption: () => mocks } } }));
import { persistSessionArchiveIntent } from './sessionArchiveMetadata';

describe('persistSessionArchiveIntent', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('preserves provider fields and concurrent metadata changes while persisting archive intent', async () => {
        mocks.request.mockResolvedValue(new Response(JSON.stringify({ session: {
            id: 'session', metadataVersion: 1, metadata: JSON.stringify({ providerPrivate: { thread: 'first' } }),
        } })));
        mocks.emitWithAck
            .mockResolvedValueOnce({ result: 'version-mismatch', version: 2, metadata: JSON.stringify({ providerPrivate: { thread: 'latest' }, name: 'Renamed' }) })
            .mockResolvedValueOnce({ result: 'success' });
        await persistSessionArchiveIntent('session');
        const [, update] = mocks.emitWithAck.mock.calls[1];
        expect(update.expectedVersion).toBe(2);
        expect(JSON.parse(update.metadata)).toMatchObject({
            providerPrivate: { thread: 'latest' }, name: 'Renamed', lifecycleState: 'archived', archivedBy: 'user',
        });
    });

    it('finds older sessions through paginated metadata on servers without the new route', async () => {
        mocks.request
            .mockResolvedValueOnce(new Response(null, { status: 404 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ sessions: [], hasNext: true, nextCursor: 'cursor_v1_previous' })))
            .mockResolvedValueOnce(new Response(JSON.stringify({ sessions: [{ id: 'old', metadataVersion: 8, metadata: '{}' }], hasNext: false })));
        mocks.emitWithAck.mockResolvedValue({ result: 'success' });
        await persistSessionArchiveIntent('old');
        expect(mocks.request.mock.calls[2][0]).toBe('/v2/sessions?limit=200&cursor=cursor_v1_previous');
        expect(mocks.emitWithAck.mock.calls[0][1].expectedVersion).toBe(8);
    });

    it('rejects failed persistence instead of reporting an unsafe archive as successful', async () => {
        mocks.request.mockResolvedValue(new Response(JSON.stringify({ session: { id: 'session', metadataVersion: 1, metadata: '{}' } })));
        mocks.emitWithAck.mockResolvedValue({ result: 'error' });
        await expect(persistSessionArchiveIntent('session')).rejects.toThrow('Could not save session archive state');
    });
});
