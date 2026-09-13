import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    available: vi.fn(), share: vi.fn(), mkdir: vi.fn(), write: vi.fn(), remove: vi.fn(),
}));
vi.mock('expo-file-system/legacy', () => ({
    cacheDirectory: 'file:///cache/', EncodingType: { Base64: 'base64' },
    makeDirectoryAsync: mocks.mkdir, writeAsStringAsync: mocks.write, deleteAsync: mocks.remove,
}));
vi.mock('expo-sharing', () => ({ isAvailableAsync: mocks.available, shareAsync: mocks.share }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'unique-id' }));
import { openAttachment } from './openAttachment';

describe('native attachment opening', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.available.mockResolvedValue(true);
        mocks.remove.mockResolvedValue(undefined);
    });

    it('shares decrypted bytes with the original filename and MIME, then removes the temporary file', async () => {
        const bytes = new TextEncoder().encode('decrypted report');
        mocks.share.mockImplementation(async () => { expect(mocks.remove).not.toHaveBeenCalled(); });
        await openAttachment('../../report.pdf', 'application/pdf', async () => bytes);
        expect(mocks.write).toHaveBeenCalledWith('file:///cache/talos-open-unique-id/report.pdf', btoa('decrypted report'), { encoding: 'base64' });
        expect(mocks.share).toHaveBeenCalledWith('file:///cache/talos-open-unique-id/report.pdf', { mimeType: 'application/pdf', dialogTitle: '../../report.pdf' });
        expect(mocks.remove).toHaveBeenCalledWith('file:///cache/talos-open-unique-id/', { idempotent: true });
    });

    it('cleans up when opening fails and allows a later retry', async () => {
        mocks.share.mockRejectedValueOnce(new Error('share failed'));
        await expect(openAttachment('report.pdf', 'application/pdf', async () => new Uint8Array([1]))).rejects.toThrow('share failed');
        expect(mocks.remove).toHaveBeenCalledTimes(1);
        await openAttachment('report.pdf', 'application/pdf', async () => new Uint8Array([1]));
        expect(mocks.share).toHaveBeenCalledTimes(2);
    });

    it('gives captioned model images a usable extension and escapes URI characters', async () => {
        await openAttachment('Corrected holding #1', 'image/png', async () => new Uint8Array([1]));
        expect(mocks.share).toHaveBeenCalledWith('file:///cache/talos-open-unique-id/Corrected%20holding%20%231.png', expect.objectContaining({ mimeType: 'image/png' }));
    });

    it('does not download or stage data when sharing is unavailable', async () => {
        mocks.available.mockResolvedValue(false);
        const load = vi.fn();
        await expect(openAttachment('report.pdf', 'application/pdf', load)).rejects.toThrow();
        expect(load).not.toHaveBeenCalled();
        expect(mocks.write).not.toHaveBeenCalled();
    });

    it('never shares data after a failed download or decryption', async () => {
        await expect(openAttachment('report.pdf', 'application/pdf', async () => { throw new Error('decrypt failed'); })).rejects.toThrow('decrypt failed');
        expect(mocks.share).not.toHaveBeenCalled();
        expect(mocks.write).not.toHaveBeenCalled();
    });
});
