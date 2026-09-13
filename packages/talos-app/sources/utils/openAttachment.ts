import { cacheDirectory, makeDirectoryAsync, writeAsStringAsync, deleteAsync, EncodingType } from 'expo-file-system/legacy';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { randomUUID } from 'expo-crypto';
import { encodeBase64 } from '@/encryption/base64';
import { attachmentFilename } from './attachmentFilename';

export async function openAttachment(name: string, mimeType: string, loadBytes: () => Promise<Uint8Array>): Promise<void> {
    if (!cacheDirectory || !await isAvailableAsync()) throw new Error('File sharing unavailable');
    const bytes = await loadBytes();
    const directory = `${cacheDirectory}talos-open-${randomUUID()}/`;
    try {
        await makeDirectoryAsync(directory, { intermediates: true });
        const uri = `${directory}${encodeURIComponent(attachmentFilename(name, mimeType))}`;
        await writeAsStringAsync(uri, encodeBase64(bytes), { encoding: EncodingType.Base64 });
        await shareAsync(uri, { mimeType, dialogTitle: name });
    } finally {
        await deleteAsync(directory, { idempotent: true }).catch(() => {});
    }
}
