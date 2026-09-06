import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiSessionClient } from '@/api/apiSession';
import { createEnvelope } from '@ahmadposten/talos-wire';

import { publishLocalImage } from './startTalosServer';

const tempDirs: string[] = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('publishLocalImage', () => {
    it('uploads image bytes as an agent attachment and sends its envelope', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'talos-present-image-'));
        tempDirs.push(dir);
        const path = join(dir, 'chart.png');
        const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
        await writeFile(path, png);

        const envelope = createEnvelope('agent', {
            t: 'file',
            ref: 'sessions/test/attachments/chart.enc',
            name: 'Portfolio chart',
            size: png.length,
            mimeType: 'image/png',
        });
        const upload = vi.fn().mockResolvedValue(envelope);
        const send = vi.fn();
        const client = {
            uploadLocalImageAttachmentEnvelope: upload,
            sendSessionProtocolMessage: send,
        } as unknown as ApiSessionClient;

        await publishLocalImage(client, path, 'Portfolio chart');

        expect(upload).toHaveBeenCalledWith({
            data: png,
            mimeType: 'image/png',
            name: 'Portfolio chart',
        }, {}, 'agent');
        expect(send).toHaveBeenCalledWith(envelope);
    });

    it('rejects files that are not supported images', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'talos-present-image-'));
        tempDirs.push(dir);
        const path = join(dir, 'notes.txt');
        await writeFile(path, 'not an image');

        const client = {
            uploadLocalImageAttachmentEnvelope: vi.fn(),
            sendSessionProtocolMessage: vi.fn(),
        } as unknown as ApiSessionClient;

        await expect(publishLocalImage(client, path)).rejects.toThrow(
            'Only PNG, JPEG, GIF, and WebP images can be published',
        );
        expect(client.uploadLocalImageAttachmentEnvelope).not.toHaveBeenCalled();
    });
});
