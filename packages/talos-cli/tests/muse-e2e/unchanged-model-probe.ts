import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MuseSession, type MuseSessionCallbacks } from '../../src/muse/MuseSession';
const cwd = mkdtempSync(join(tmpdir(), 'talos-muse-unchanged-adapter-'));
let messages: string[] = [];
const callbacks: MuseSessionCallbacks = {
    message(m) { if (m.data?.type === 'message') messages.push(m.data.message); },
    metadata() {}, mode() {}, activity() {}, notice: console.error,
    permission: async () => ({ decision: 'denied' }), exited() {},
};
let session = new MuseSession(cwd, callbacks, ['--trust-workspace']);
const deadline = setTimeout(() => { console.error('Probe timed out'); process.exit(1); }, 180000);
try {
    await session.start();
    const id = session.sessionId;
    for (let cycle = 0; cycle < 3; cycle++) {
        if (cycle) {
            await session.dispose();
            session = new MuseSession(cwd, callbacks, ['--trust-workspace']);
            await session.start(id);
        }
        messages = [];
        await session.prompt(cycle === 0
            ? 'Remember copper-otter. Reply only with that code word. Do not use tools.'
            : 'What was the code word? Reply only with it. Do not use tools.');
        const passed = session.sessionId === id && messages.join('\n').includes('copper-otter');
        console.log(JSON.stringify({ cycle, id, messages, passed }));
        if (!passed) throw new Error('Session identity or remembered context failed');
    }
    if (process.env.MUSE_TEST_HANDOFF === '1') {
        await session.switchMode('local');
        await new Promise(resolve => setTimeout(resolve, 8000));
        await session.switchMode('remote');
        messages = [];
        await session.prompt('What was the code word? Reply only with it. Do not use tools.');
        const passed = session.sessionId === id && messages.join('\n').includes('copper-otter');
        console.log(JSON.stringify({ handoff: true, id, messages, passed }));
        if (!passed) throw new Error('Handoff lost conversation context');
    }
} finally { clearTimeout(deadline); await session.dispose(); rmSync(cwd, { recursive: true, force: true }); }
