import { randomUUID } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';

import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';
import type { PendingAttachment } from '@/utils/MessageQueue2';

import type { InputItem } from '../codexAppServerTypes';

import { detectSupportedImageType } from '@/utils/imageType';
export { detectSupportedImageType, type SupportedImageType } from '@/utils/imageType';

export type PreparedCodexImageInputs = {
    inputItems: InputItem[];
    /** Non-image attachments written to disk for Codex tools to read. */
    filePaths: string[];
    skipped: number;
};

export function resolveCodexImageCacheDir(opts: {
    sessionId: string;
    cacheRootDir?: string;
}): string {
    const cacheRoot = resolve(opts.cacheRootDir ?? join(configuration.talosHomeDir, 'codex-image-cache'));
    const sessionKey = sanitizeCachePathSegment(opts.sessionId);
    const cacheDir = resolve(cacheRoot, sessionKey);
    const relativePath = relative(cacheRoot, cacheDir);
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
        return join(cacheRoot, 'invalid-session');
    }
    return cacheDir;
}

function sanitizeCachePathSegment(value: string): string {
    const sanitized = value
        .trim()
        .replace(/[\\/]+/g, '_')
        .replace(/\.+/g, '_')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/^_+|_+$/g, '');
    return sanitized.length > 0 ? sanitized : 'unknown-session';
}

export async function prepareCodexImageInputItems(
    attachments: PendingAttachment[] | undefined,
    opts: {
        sessionId: string;
        cacheRootDir?: string;
    },
): Promise<PreparedCodexImageInputs> {
    if (!attachments || attachments.length === 0) {
        return { inputItems: [], filePaths: [], skipped: 0 };
    }

    const cacheDir = resolveCodexImageCacheDir(opts);
    const inputItems: InputItem[] = [];
    const filePaths: string[] = [];
    let skipped = 0;

    for (const attachment of attachments) {
        const detected = detectSupportedImageType(attachment.data);

        try {
            await mkdir(cacheDir, { recursive: true, mode: 0o700 });
            await chmod(cacheDir, 0o700);
            const originalExtension = extname(attachment.name).toLowerCase();
            const safeExtension = /^\.[a-z0-9]{1,10}$/.test(originalExtension)
                ? originalExtension
                : '.bin';
            const filePath = join(
                cacheDir,
                detected ? `${randomUUID()}.${detected.extension}` : `${randomUUID()}${safeExtension}`,
            );
            await writeFile(filePath, Buffer.from(attachment.data), { mode: 0o600 });
            if (detected) {
                inputItems.push({ type: 'localImage', path: filePath });
            } else {
                filePaths.push(filePath);
            }
        } catch (error) {
            logger.debug('[Codex] Failed to cache attachment for turn input', {
                mimeType: attachment.mimeType,
                size: attachment.data.length,
                errorName: error instanceof Error ? error.name : typeof error,
            });
            skipped += 1;
        }
    }

    return { inputItems, filePaths, skipped };
}
