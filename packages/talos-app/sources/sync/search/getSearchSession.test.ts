import { describe, expect, it, vi } from 'vitest';
import type { SearchSessionDescriptor } from './searchCoordinator';
import { getSearchSession, SearchRequestError } from './getSearchSession';

const session = (id: string): SearchSessionDescriptor => ({
    id, seq: 7, metadata: 'fresh-encrypted-metadata', metadataVersion: 2,
    agentState: null, agentStateVersion: 0, dataEncryptionKey: null,
    active: false, activeAt: 1, createdAt: 1, updatedAt: 2, lastMessageAt: 2,
});

describe('search result session lookup', () => {
    it('uses the current single-session endpoint without listing history', async () => {
        const expected = session('id/with space');
        const request = vi.fn().mockResolvedValue({ session: expected });
        await expect(getSearchSession(expected.id, request)).resolves.toEqual(expected);
        expect(request.mock.calls).toEqual([['/v1/sessions/id%2Fwith%20space']]);
    });

    it('finds an archived result beyond the first 200 sessions on an older relay', async () => {
        const expected = session('archived-result');
        const request = vi.fn()
            .mockRejectedValueOnce(new SearchRequestError(404))
            .mockResolvedValueOnce({ sessions: Array.from({ length: 200 }, (_, i) => session(`other-${i}`)), nextCursor: 'cursor+200', hasNext: true })
            .mockResolvedValueOnce({ sessions: [expected], nextCursor: null, hasNext: false });
        await expect(getSearchSession(expected.id, request)).resolves.toEqual(expected);
        expect(request.mock.calls).toEqual([
            ['/v1/sessions/archived-result'],
            ['/v2/sessions?limit=200'],
            ['/v2/sessions?limit=200&cursor=cursor%2B200'],
        ]);
    });

    it('rejects a deleted or inaccessible result instead of opening stale cached metadata', async () => {
        const request = vi.fn()
            .mockRejectedValueOnce(new SearchRequestError(404))
            .mockResolvedValueOnce({ sessions: [session('other')], nextCursor: null, hasNext: false });
        await expect(getSearchSession('deleted', request)).rejects.toThrow('no longer available');
    });

    it.each([401, 403, 429, 500])('does not fall back after HTTP %i', async status => {
        const error = new SearchRequestError(status);
        const request = vi.fn().mockRejectedValue(error);
        await expect(getSearchSession('history', request)).rejects.toBe(error);
        expect(request).toHaveBeenCalledTimes(1);
    });

    it('does not retry an aborted request through a different endpoint', async () => {
        const error = new DOMException('Aborted', 'AbortError');
        const request = vi.fn().mockRejectedValue(error);
        await expect(getSearchSession('history', request)).rejects.toBe(error);
        expect(request).toHaveBeenCalledTimes(1);
    });

    it('preserves authorization errors from the fallback list', async () => {
        const error = new SearchRequestError(401);
        const request = vi.fn().mockRejectedValueOnce(new SearchRequestError(404)).mockRejectedValueOnce(error);
        await expect(getSearchSession('history', request)).rejects.toBe(error);
    });

    it.each([null, 'repeated'])('stops if pagination cannot advance (%s)', async nextCursor => {
        const request = vi.fn()
            .mockRejectedValueOnce(new SearchRequestError(404))
            .mockResolvedValue({ sessions: [], nextCursor, hasNext: true });
        await expect(getSearchSession('history', request)).rejects.toThrow('Unable to finish');
        expect(request).toHaveBeenCalledTimes(nextCursor ? 3 : 2);
    });
});
