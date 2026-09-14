/** Maximum original file size accepted by the attachment pickers (100 MiB). */
export const MAX_ATTACHMENT_FILE_BYTES = 100 * 1024 * 1024;

/** Secretbox blobs contain a 24-byte nonce and a 16-byte authentication tag. */
export const ATTACHMENT_ENCRYPTION_OVERHEAD_BYTES = 24 + 16;

/** Transfer limits apply to encrypted bytes, including the secretbox envelope. */
export const MAX_ENCRYPTED_ATTACHMENT_BYTES = MAX_ATTACHMENT_FILE_BYTES + ATTACHMENT_ENCRYPTION_OVERHEAD_BYTES;
