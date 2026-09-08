import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileStatusReason } from '@/api/types';
import { configuration } from '@/configuration';
import { detectSupportedImageType } from '@/utils/imageType';
import type { PendingAttachment } from '@/utils/MessageQueue2';

// MSP v1 accepts inline images; other files are mentioned in text as @paths.
export type MuseInputPart =
    | { type: 'text'; text: string }
    | { type: 'image'; mediaType: string; base64Data: string };

export async function prepareMuseAttachments(attachments: PendingAttachment[], sessionId: string,
    cacheRoot = join(configuration.talosHomeDir, 'muse', 'attachments')) {
    const input: MuseInputPart[] = [];
    const accepted: string[] = [];
    const rejected: { ref: string; reason: FileStatusReason }[] = [];
    // Keep file references stable across host restart/resume and terminal handoff.
    // Hash the native session ID so no wire value can escape the cache root.
    const directory = join(cacheRoot, createHash('sha256').update(sessionId).digest('hex'));
    for (const attachment of attachments) {
        if (attachment.data.length === 0) {
            rejected.push({ ref: attachment.ref, reason: 'empty_bytes' });
            continue;
        }
        const image = detectSupportedImageType(attachment.data);
        if (image) {
            input.push({ type: 'image', mediaType: image.mimeType, base64Data: Buffer.from(attachment.data).toString('base64') });
            accepted.push(attachment.ref);
            continue;
        }
        try {
            await mkdir(directory, { recursive: true, mode: 0o700 });
            await chmod(directory, 0o700);
            const name = attachment.name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').slice(-120) || 'attachment';
            const path = join(directory, `${randomUUID()}-${name}`);
            await writeFile(path, attachment.data, { flag: 'wx', mode: 0o600 });
            input.push({ type: 'text', text: `Attached file: @${path}` });
            accepted.push(attachment.ref);
        } catch {
            rejected.push({ ref: attachment.ref, reason: 'tempfile_write_failed' });
        }
    }
    return { input, accepted, rejected };
}
