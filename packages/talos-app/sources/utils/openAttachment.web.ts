import { attachmentFilename } from './attachmentFilename';

export async function openAttachment(name: string, mimeType: string, loadBytes: () => Promise<Uint8Array>): Promise<void> {
    // Reserve the tab during the tap, before downloading, to avoid popup blockers.
    // Only passive formats may be navigated to on the app's blob origin.
    const canPreview = /^(application\/pdf|text\/plain|image\/(png|jpeg|gif|webp)|audio\/[\w.+-]+|video\/[\w.+-]+)$/.test(mimeType);
    const tab = canPreview ? window.open('about:blank', '_blank') : null;
    if (tab) tab.opener = null;
    try {
        const bytes = await loadBytes();
        const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeType }));
        try {
            if (tab && !tab.closed) {
                tab.location.replace(url);
            } else {
                const link = document.createElement('a');
                link.href = url;
                link.download = attachmentFilename(name, mimeType);
                document.body.appendChild(link);
                link.click();
                link.remove();
            }
        } finally {
            // Let the browser finish consuming the URL, then release decrypted data.
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
        }
    } catch (error) {
        tab?.close();
        throw error;
    }
}
