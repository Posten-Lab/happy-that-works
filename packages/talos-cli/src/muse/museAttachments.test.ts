import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { prepareMuseAttachments } from './museAttachments';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function root() { const p = await mkdtemp(join(tmpdir(), 'muse-attachment-test-')); roots.push(p); return p; }

describe('Muse attachment inputs', () => {
    it('sniffs image bytes instead of trusting the supplied MIME or filename', async () => {
        const data = Buffer.from('89504e470d0a1a0a', 'hex');
        const result = await prepareMuseAttachments([{ ref: 'img', data, mimeType: 'text/plain', name: 'file.txt' }], 'session', await root());
        expect(result).toEqual({ input: [{ type: 'image', mediaType: 'image/png', base64Data: data.toString('base64') }], accepted: ['img'], rejected: [] });
    });
    it('writes documents and unknown formats to private persistent files with safe distinct names', async () => {
        const cache = await root();
        const data = Buffer.from('attachment content');
        const result = await prepareMuseAttachments([
            { ref: 'doc', data, mimeType: 'image/png', name: '../../same file.txt' },
            { ref: 'doc2', data, mimeType: 'text/plain', name: '../../same file.txt' },
        ], '../../outside', cache);
        expect(result.accepted).toEqual(['doc', 'doc2']);
        const paths = result.input.map(part => part.type === 'text' ? part.text.split('@')[1] : '');
        expect(paths[0]).not.toBe(paths[1]);
        for (const path of paths) {
            expect(relative(cache, path).startsWith('..')).toBe(false);
            expect(await readFile(path)).toEqual(data);
            if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600);
        }
    });
    it('reports empty bytes and disk failures without losing other images in the batch', async () => {
        const cache = join(await root(), 'not-a-directory');
        await writeFile(cache, 'blocked');
        const result = await prepareMuseAttachments([
            { ref: 'empty', data: new Uint8Array(), mimeType: 'text/plain', name: 'empty' },
            { ref: 'file', data: Buffer.from('text'), mimeType: 'text/plain', name: 'file' },
            { ref: 'img', data: Buffer.from('89504e470d0a1a0a', 'hex'), mimeType: 'image/png', name: 'image' },
        ], 'session', cache);
        expect(result.accepted).toEqual(['img']);
        expect(result.rejected).toEqual([{ ref: 'empty', reason: 'empty_bytes' }, { ref: 'file', reason: 'tempfile_write_failed' }]);
    });
});
