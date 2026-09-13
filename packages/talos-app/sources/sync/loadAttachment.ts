import { sync } from './sync';
import { downloadEncryptedAttachment } from './apiAttachments';
import { decryptBlob } from '@/encryption/blob';

/** Only decrypted bytes may be handed to an image viewer or another app. */
export async function loadAttachment(sessionId: string, ref: string): Promise<Uint8Array> {
    const credentials = sync.getCredentials();
    const key = sync.encryption.getSessionBlobKey(sessionId);
    if (!credentials || !key) throw new Error('Attachment credentials unavailable');
    const encrypted = await downloadEncryptedAttachment(credentials, sessionId, ref);
    const bytes = decryptBlob(encrypted, key);
    if (!bytes) throw new Error('Attachment decryption failed');
    return bytes;
}
