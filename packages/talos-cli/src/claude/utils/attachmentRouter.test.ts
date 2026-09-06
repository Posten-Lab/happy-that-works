import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    detectMagic,
    looksLikeUtf8Text,
    resolveMime,
    classifyAttachment,
    routeAttachment,
    routeBatch,
    IMAGE_BLOCK_RAW_LIMIT,
    DOCUMENT_BLOCK_RAW_LIMIT,
} from './attachmentRouter';

// Magic-byte prefixes for each format the router recognises. We wrap them in
// bytes just long enough to satisfy detectMagic's length guards.
const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const JPEG_MAGIC = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0]);
const GIF_MAGIC = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);
const WEBP_MAGIC = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
]);
const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x37]);
const MP4_MAGIC = new Uint8Array([
    0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6F, 0x6D,
]);
const HEIC_MAGIC = new Uint8Array([
    0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
]);
const WEBM_MAGIC = new Uint8Array([0x1A, 0x45, 0xDF, 0xA3, 0, 0, 0, 0]);

function pad(magic: Uint8Array, totalLen: number, filler = 0): Uint8Array {
    if (magic.length >= totalLen) return magic;
    const out = new Uint8Array(totalLen);
    out.set(magic, 0);
    for (let i = magic.length; i < totalLen; i++) out[i] = filler;
    return out;
}

describe('detectMagic', () => {
    it('detects PNG', () => {
        expect(detectMagic(PNG_MAGIC)).toBe('image/png');
    });
    it('detects JPEG', () => {
        expect(detectMagic(JPEG_MAGIC)).toBe('image/jpeg');
    });
    it('detects GIF87a and GIF89a variants (via 4-byte prefix)', () => {
        expect(detectMagic(GIF_MAGIC)).toBe('image/gif');
    });
    it('detects WebP (RIFF...WEBP)', () => {
        expect(detectMagic(WEBP_MAGIC)).toBe('image/webp');
    });
    it('detects PDF', () => {
        expect(detectMagic(PDF_MAGIC)).toBe('application/pdf');
    });
    it('detects MP4 as video/mp4', () => {
        expect(detectMagic(MP4_MAGIC)).toBe('video/mp4');
    });
    it('detects HEIC as image/heic', () => {
        expect(detectMagic(HEIC_MAGIC)).toBe('image/heic');
    });
    it('detects WebM', () => {
        expect(detectMagic(WEBM_MAGIC)).toBe('video/webm');
    });
    it('returns undefined for unknown bytes', () => {
        expect(detectMagic(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toBeUndefined();
    });
    it('returns undefined for too-short input', () => {
        expect(detectMagic(new Uint8Array([0x89]))).toBeUndefined();
    });
});

describe('looksLikeUtf8Text', () => {
    it('accepts ASCII markdown', () => {
        const bytes = new TextEncoder().encode('# Hello\n\nThis is markdown.\n');
        expect(looksLikeUtf8Text(bytes)).toBe(true);
    });
    it('accepts UTF-8 with emoji', () => {
        const bytes = new TextEncoder().encode('こんにちは 🌸 world');
        expect(looksLikeUtf8Text(bytes)).toBe(true);
    });
    it('rejects bytes containing NUL', () => {
        const bytes = new Uint8Array([0x48, 0x65, 0x6C, 0, 0x6C, 0x6F]);
        expect(looksLikeUtf8Text(bytes)).toBe(false);
    });
    it('rejects invalid UTF-8', () => {
        // 0xC3 starts a 2-byte sequence but 0x28 is not a valid continuation.
        const bytes = new Uint8Array([0xC3, 0x28, 0x41, 0x42]);
        expect(looksLikeUtf8Text(bytes)).toBe(false);
    });
    it('rejects empty input', () => {
        expect(looksLikeUtf8Text(new Uint8Array(0))).toBe(false);
    });
});

describe('resolveMime tie-break', () => {
    it('magic wins over wire mimeType', () => {
        const a = { ref: 'r', data: PNG_MAGIC, mimeType: 'application/octet-stream', name: 'foo.jpg' };
        expect(resolveMime(a)).toBe('image/png');
    });
    it('wire mimeType wins over extension', () => {
        const a = { ref: 'r', data: new Uint8Array([1, 2, 3, 4]), mimeType: 'text/csv', name: 'foo.txt' };
        expect(resolveMime(a)).toBe('text/csv');
    });
    it('extension wins over utf8 probe when no magic + no wire mime', () => {
        const a = { ref: 'r', data: new TextEncoder().encode('#!/bin/bash\necho hi'), name: 'script.sh' };
        expect(resolveMime(a)).toBe('application/x-sh');
    });
    it('utf8 probe wins over octet-stream when no ext hint', () => {
        const a = { ref: 'r', data: new TextEncoder().encode('plain text without extension'), name: 'notes' };
        expect(resolveMime(a)).toBe('text/plain');
    });
    it('falls back to octet-stream for unknown binary', () => {
        // NUL byte kills the utf8 probe; no ext → octet-stream.
        const a = { ref: 'r', data: new Uint8Array([1, 2, 3, 0, 4, 5]), name: 'blob' };
        expect(resolveMime(a)).toBe('application/octet-stream');
    });
});

describe('classifyAttachment decision matrix', () => {
    it('routes small PNG as image block', () => {
        expect(classifyAttachment({ ref: 'r', data: PNG_MAGIC, name: 'a.png' })).toBe('image');
    });
    it('routes oversized PNG as path (downgrade)', () => {
        // Fake a "big" PNG by keeping the magic prefix and padding out to the
        // size cap +1 byte. Router only reads first bytes for magic; the size
        // check is on data.length.
        const big = pad(PNG_MAGIC, IMAGE_BLOCK_RAW_LIMIT + 1);
        expect(classifyAttachment({ ref: 'r', data: big, name: 'big.png' })).toBe('path');
    });
    it('routes HEIC as path (Anthropic image block rejects HEIC)', () => {
        expect(classifyAttachment({ ref: 'r', data: HEIC_MAGIC, name: 'a.heic' })).toBe('path');
    });
    it('routes small PDF as document block', () => {
        expect(classifyAttachment({ ref: 'r', data: PDF_MAGIC, name: 'a.pdf' })).toBe('document');
    });
    it('routes oversized PDF as path (downgrade past document cap)', () => {
        const big = pad(PDF_MAGIC, DOCUMENT_BLOCK_RAW_LIMIT + 1);
        expect(classifyAttachment({ ref: 'r', data: big, name: 'big.pdf' })).toBe('path');
    });
    it('routes MP4 video as path', () => {
        expect(classifyAttachment({ ref: 'r', data: MP4_MAGIC, name: 'a.mp4' })).toBe('path');
    });
    it('routes text/markdown as path', () => {
        const bytes = new TextEncoder().encode('# hello\nworld\n');
        expect(classifyAttachment({ ref: 'r', data: bytes, name: 'notes.md' })).toBe('path');
    });
    it('routes SVG as path (image block rejects SVG media_type)', () => {
        const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" />');
        expect(classifyAttachment({ ref: 'r', data: bytes, mimeType: 'image/svg+xml', name: 'a.svg' })).toBe('path');
    });
    it('routes unknown binary as path', () => {
        const bytes = new Uint8Array([1, 2, 3, 0, 4, 5, 6, 7]);
        expect(classifyAttachment({ ref: 'r', data: bytes, name: 'blob.bin' })).toBe('path');
    });
});

describe('routeAttachment single-file behaviour', () => {
    let tempDir: string;
    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'talos-router-test-'));
    });
    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('rejects empty bytes', async () => {
        const r = await routeAttachment({ ref: 'r1', data: new Uint8Array(0), name: 'empty' }, { tempDir });
        expect(r.kind).toBe('reject');
        if (r.kind === 'reject') expect(r.reason).toBe('empty_bytes');
    });

    it('produces a base64 image block for PNG', async () => {
        const r = await routeAttachment({ ref: 'r2', data: PNG_MAGIC, name: 'a.png' }, { tempDir });
        expect(r.kind).toBe('image');
        if (r.kind === 'image') {
            expect(r.block).toEqual({
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: Buffer.from(PNG_MAGIC).toString('base64'),
                },
            });
        }
    });

    it('produces a base64 document block for PDF', async () => {
        const r = await routeAttachment({ ref: 'r3', data: PDF_MAGIC, name: 'a.pdf' }, { tempDir });
        expect(r.kind).toBe('document');
        if (r.kind === 'document') {
            expect(r.block).toEqual({
                type: 'document',
                source: {
                    type: 'base64',
                    media_type: 'application/pdf',
                    data: Buffer.from(PDF_MAGIC).toString('base64'),
                },
            });
        }
    });

    it('writes video bytes to temp file and returns @path', async () => {
        const r = await routeAttachment({ ref: 'r4', data: MP4_MAGIC, name: 'clip.mp4' }, { tempDir });
        expect(r.kind).toBe('path');
        if (r.kind === 'path') {
            const written = await fs.readFile(r.absPath);
            expect(new Uint8Array(written)).toEqual(MP4_MAGIC);
            expect(r.absPath.startsWith(tempDir)).toBe(true);
            expect(r.displayName).toBe('clip.mp4');
        }
    });

    it('is content-addressed: same bytes twice reuse the same file', async () => {
        const first = await routeAttachment({ ref: 'r5a', data: MP4_MAGIC, name: 'clip.mp4' }, { tempDir });
        const second = await routeAttachment({ ref: 'r5b', data: MP4_MAGIC, name: 'clip.mp4' }, { tempDir });
        expect(first.kind).toBe('path');
        expect(second.kind).toBe('path');
        if (first.kind === 'path' && second.kind === 'path') {
            expect(first.absPath).toBe(second.absPath);
        }
    });

    it('sanitizes path separators so a hostile filename stays inside tempDir', async () => {
        const r = await routeAttachment(
            { ref: 'r6', data: new Uint8Array([1, 2, 3, 4]), name: '../../../etc/passwd' },
            { tempDir },
        );
        expect(r.kind).toBe('path');
        if (r.kind === 'path') {
            // The critical guarantee is containment: `path.dirname` of the
            // written file resolves back to tempDir. The `..` characters may
            // survive inside the filename itself (they're valid filename
            // characters); what must NOT survive are `/` separators that
            // would let the write escape the sandbox.
            expect(path.dirname(r.absPath)).toBe(tempDir);
            const base = path.basename(r.absPath);
            expect(base.includes('/')).toBe(false);
            expect(base.includes('\\')).toBe(false);
        }
    });
});

describe('routeBatch assembly', () => {
    let tempDir: string;
    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'talos-router-batch-'));
    });
    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('returns plain string when there are no attachments (hot-path preserved)', async () => {
        const r = await routeBatch([], 'hello', { tempDir });
        expect(r.content).toBe('hello');
        expect(r.accepted).toEqual([]);
        expect(r.rejected).toEqual([]);
    });

    it('orders blocks as [images, documents, text-with-@paths]', async () => {
        const atts = [
            { ref: 'mp4-a', data: MP4_MAGIC, name: 'video.mp4' },
            { ref: 'pdf-a', data: PDF_MAGIC, name: 'doc.pdf' },
            { ref: 'png-a', data: PNG_MAGIC, name: 'photo.png' },
            { ref: 'txt-a', data: new TextEncoder().encode('# notes'), name: 'notes.md' },
        ];
        const r = await routeBatch(atts, 'summarize these', { tempDir });
        expect(Array.isArray(r.content)).toBe(true);
        if (!Array.isArray(r.content)) return;
        // 1 image + 1 doc + 1 text = 3 blocks
        expect(r.content).toHaveLength(3);
        expect(r.content[0].type).toBe('image');
        expect(r.content[1].type).toBe('document');
        expect(r.content[2].type).toBe('text');
        if (r.content[2].type === 'text') {
            // Two @paths, order = images/docs first (none in this case) then
            // path-bucket order = upload order (mp4 first, then md).
            expect(r.content[2].text.startsWith('@')).toBe(true);
            expect(r.content[2].text.endsWith('\nsummarize these')).toBe(true);
            expect(r.content[2].text.split('@').length).toBe(3); // '' + 2 paths
        }
        expect(r.accepted.sort()).toEqual(['mp4-a', 'pdf-a', 'png-a', 'txt-a'].sort());
        expect(r.rejected).toEqual([]);
    });

    it('emits @paths-only text block when there are no image/document blocks', async () => {
        const atts = [
            { ref: 'mp4-a', data: MP4_MAGIC, name: 'clip.mp4' },
        ];
        const r = await routeBatch(atts, 'watch this', { tempDir });
        expect(Array.isArray(r.content)).toBe(true);
        if (!Array.isArray(r.content)) return;
        expect(r.content).toHaveLength(1);
        expect(r.content[0].type).toBe('text');
    });

    it('emits a bare text block with empty user text but only @paths', async () => {
        const atts = [
            { ref: 'mp4-a', data: MP4_MAGIC, name: 'clip.mp4' },
        ];
        const r = await routeBatch(atts, '', { tempDir });
        expect(Array.isArray(r.content)).toBe(true);
        if (!Array.isArray(r.content)) return;
        expect(r.content).toHaveLength(1);
        expect(r.content[0].type).toBe('text');
        if (r.content[0].type === 'text') {
            expect(r.content[0].text.startsWith('@')).toBe(true);
            expect(r.content[0].text.includes('\n')).toBe(false);
        }
    });

    it('records rejections for empty attachments and keeps rest accepted', async () => {
        const atts = [
            { ref: 'good', data: PNG_MAGIC, name: 'photo.png' },
            { ref: 'bad', data: new Uint8Array(0), name: 'empty' },
        ];
        const r = await routeBatch(atts, 'x', { tempDir });
        expect(r.accepted).toEqual(['good']);
        expect(r.rejected).toEqual([{ ref: 'bad', reason: 'empty_bytes' }]);
    });
});
