export function attachmentFilename(name: string, mimeType?: string): string {
    // Captions and remote paths are not necessarily valid local filenames.
    const filename = name.split(/[/\\]/).pop()?.replace(/[\x00-\x1f\x7f:]/g, '_').trim();
    const safeName = filename && filename !== '.' && filename !== '..' ? filename.slice(-180) : 'attachment';
    const extensions: Record<string, string[]> = {
        'image/png': ['png'], 'image/jpeg': ['jpg', 'jpeg'], 'image/gif': ['gif'],
        'image/webp': ['webp'], 'application/pdf': ['pdf'], 'text/plain': ['txt'],
    };
    const expected = mimeType ? extensions[mimeType] : undefined;
    // Model image output often uses a descriptive caption as its name. Native
    // viewers need the extension to recognize these files after sharing.
    return expected && !expected.some(extension => safeName.toLowerCase().endsWith(`.${extension}`))
        ? `${safeName}.${expected[0]}` : safeName;
}
