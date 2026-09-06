/**
 * Shared types for attachment upload pipeline. Covers images, videos, PDFs,
 * and arbitrary files — the CLI-side router decides how to hand each type
 * to Claude (inline image block, PDF document block, or `@<path>` for
 * everything else).
 */

/**
 * Composer-side per-attachment status. The CLI emits a `file-status` event
 * back to the app after routing, and the strip flips the chip accordingly.
 */
export type AttachmentStatus = 'pending' | 'accepted' | 'rejected';

/** Machine-checkable reasons the CLI can report for a rejection. */
export type AttachmentRejectionReason =
    | 'download_failed'
    | 'decrypt_failed'
    | 'empty_bytes'
    | 'image_too_large'
    | 'document_too_large'
    | 'tempfile_write_failed'
    | 'unsupported';

export type AttachmentPreview = {
    /** Stable unique identifier for use as React key and for removal. */
    id: string;
    uri: string;
    /**
     * Set once the attachment has been uploaded — this is what the CLI-side
     * `file-status` back-channel keys on. Populated by sync after upload;
     * used to correlate `t:'file-status'` events to a specific chip.
     */
    ref?: string;
    /** 0 for non-image attachments; positive for images and video posters. */
    width: number;
    height: number;
    mimeType: string;
    /** May be 0 if the system did not provide the file size. */
    size: number;
    name: string;
    /** Only meaningful for images (RN Canvas is needed to compute it). */
    thumbhash?: string;
    /** Post-upload delivery status the composer strip renders. */
    status?: AttachmentStatus;
    /** Reason attached when status is 'rejected'. */
    reason?: AttachmentRejectionReason;
    /**
     * True for non-image attachments (documents, videos, generic files) so
     * the strip can pick the compact "chip" variant instead of a thumbnail.
     */
    isFile?: boolean;
};

/** Result of a successful attachment upload — ready to build a file event. */
export type UploadedAttachment = {
    ref: string;
    name: string;
    size: number;
    mimeType: string;
    width: number;
    height: number;
    thumbhash?: string;
    /** Present only for videos. Duration is optional — pickers vary. */
    video?: {
        width: number;
        height: number;
        durationMs?: number;
        thumbhash?: string;
    };
    /** Client-side preview id — used to correlate file-status back to the chip. */
    localId?: string;
};
