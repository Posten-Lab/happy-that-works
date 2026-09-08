import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MuseSession, type MuseSessionCallbacks } from '../../src/muse/MuseSession';
const cwd = await mkdtemp(join(tmpdir(), 'talos-muse-attachment-e2e-'));
const messages: string[] = [];
const statuses: unknown[] = [];
const callbacks: MuseSessionCallbacks = {
    message: m => { if (m.data?.type === 'message') { messages.push(m.data.message); console.log('REPLY', m.data.message); } },
    metadata() {}, mode() {}, activity() {}, notice: console.error,
    permission: async () => ({ decision: 'approved' }), exited() {},
    fileStatus: (ref, status, reason) => { statuses.push({ ref, status, reason }); console.log('STATUS', ref, status, reason ?? ''); },
};
let session = new MuseSession(cwd, callbacks);
const deadline = setTimeout(() => { void session.dispose().finally(() => process.exit(1)); }, 180000);
try {
    await session.start();
    await session.prompt('Read the code in the attached image and describe the colored shape. Do not use tools.', {}, [
        { ref: 'image', name: 'attachment.png', mimeType: 'image/png', data: await readFile(new URL('./fixtures/attachment.png', import.meta.url)) },
    ]);
    if (!/MAPLE.?482/i.test(messages.join('\n')) || !/green/i.test(messages.join('\n')) || !/circle/i.test(messages.join('\n'))) throw new Error('Image content not recognized');
    messages.length = 0;
    await session.prompt('Read the attached file using your tools and reply with the exact code stored in it.', {}, [
        { ref: 'file', name: 'secret code.txt', mimeType: 'text/plain', data: Buffer.from('The verification code is cobalt-713-otter.') },
    ]);
    if (!messages.join('\n').includes('cobalt-713-otter')) throw new Error('File content not read');
    const id = session.sessionId;
    await session.dispose();
    session = new MuseSession(cwd, callbacks);
    await session.start(id);
    messages.length = 0;
    await session.prompt('Read that same attached text file again using your tools, then reply with its exact verification code.');
    if (!messages.join('\n').includes('cobalt-713-otter')) throw new Error('File not readable after resume');
    if (statuses.length !== 2 || statuses.some(s => (s as any).status !== 'accepted')) throw new Error('Attachment status not accepted');
    console.log('MUSE_ATTACHMENTS_IMAGE_FILE_RESUME_PASSED', id);
} finally { clearTimeout(deadline); await session.dispose(); await rm(cwd, { recursive: true, force: true }); }
