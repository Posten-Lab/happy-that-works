import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openAttachment } from './openAttachment.web';

describe('web attachment opening', () => {
    const tab = { opener: {}, closed: false, location: { replace: vi.fn() }, close: vi.fn() };
    const link = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    const open = vi.fn();
    const create = vi.fn();
    const revoke = vi.fn();
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        tab.closed = false;
        open.mockReturnValue(tab);
        create.mockReturnValue('blob:decrypted');
        vi.stubGlobal('window', { open });
        vi.stubGlobal('document', { createElement: () => link, body: { appendChild: vi.fn() } });
        vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    });
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

    it('reserves a tab during the tap and opens the decrypted PDF', async () => {
        let finish!: (bytes: Uint8Array) => void;
        const pending = openAttachment('report.pdf', 'application/pdf', () => new Promise(resolve => { finish = resolve; }));
        expect(open).toHaveBeenCalledWith('about:blank', '_blank');
        expect(tab.opener).toBeNull();
        expect(tab.location.replace).not.toHaveBeenCalled();
        finish(new Uint8Array([37, 80, 68, 70]));
        await pending;
        const blob = create.mock.calls[0][0] as Blob;
        expect(blob.type).toBe('application/pdf');
        expect(await blob.text()).toBe('%PDF');
        expect(tab.location.replace).toHaveBeenCalledWith('blob:decrypted');
        expect(revoke).not.toHaveBeenCalled();
        vi.advanceTimersByTime(60_000);
        expect(revoke).toHaveBeenCalledWith('blob:decrypted');
    });

    it('downloads with a safe filename when popups are blocked', async () => {
        open.mockReturnValue(null);
        await openAttachment('../../report.pdf', 'application/pdf', async () => new Uint8Array([1]));
        expect(link.download).toBe('report.pdf');
        expect(link.click).toHaveBeenCalled();
        expect(link.remove).toHaveBeenCalled();
    });

    it.each(['text/html', 'image/svg+xml', 'application/octet-stream'])('downloads %s instead of navigating to active content', async mime => {
        await openAttachment('output.html', mime, async () => new Uint8Array([1]));
        expect(open).not.toHaveBeenCalled();
        expect(link.click).toHaveBeenCalled();
    });

    it('closes the reserved tab on failure without exposing encrypted data', async () => {
        await expect(openAttachment('report.pdf', 'application/pdf', async () => { throw new Error('decrypt failed'); })).rejects.toThrow('decrypt failed');
        expect(tab.close).toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
    });
});
