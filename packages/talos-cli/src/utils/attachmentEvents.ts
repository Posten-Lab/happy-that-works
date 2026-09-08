import type { ApiSessionClient } from '@/api/apiSession';
import type { FileEventMessage } from '@/api/types';
import { logger } from '@/ui/logger';
import type { PendingAttachment } from '@/utils/MessageQueue2';

type AttachmentDownloader = Pick<ApiSessionClient, 'downloadAndDecryptAttachment' | 'sendFileStatus'>;

export async function downloadFileEventAttachment(
    session: AttachmentDownloader,
    fileEvent: FileEventMessage,
): Promise<PendingAttachment | null> {
    const ev = fileEvent.content.data.ev;
    try {
        const decrypted = await session.downloadAndDecryptAttachment(ev.ref);
        if (!decrypted) {
            logger.debug('[Attachment] Failed to decrypt attachment');
            session.sendFileStatus(ev.ref, 'rejected', 'decrypt_failed');
            return null;
        }
        return {
            ref: ev.ref,
            data: decrypted,
            mimeType: ev.mimeType ?? 'application/octet-stream',
            name: ev.name,
        };
    } catch (error) {
        logger.debug('[Attachment] Failed to download attachment', {
            errorName: error instanceof Error ? error.name : typeof error,
        });
        session.sendFileStatus(ev.ref, 'rejected', 'download_failed');
        return null;
    }
}
