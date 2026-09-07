import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { MuseSession } from '../../src/muse/MuseSession';
if (process.env.MUSE_TEST_ROOT) process.chdir(process.env.MUSE_TEST_ROOT + '/packages/talos-cli');
const signal = process.env.MUSE_TEST_SIGNAL || '/tmp/talos-muse-manual-handoff';
const deadline = setTimeout(() => { void session.dispose().finally(() => process.exit(1)); }, 180000);
const replies: string[] = [];
const session = new MuseSession(process.cwd(), {
    message(m) { if (m.data?.type === 'message') replies.push(m.data.message); }, metadata() {}, activity() {}, notice: console.error,
    mode(mode) { if (mode === 'remote') console.log('TALOS_REMOTE_READY'); },
    permission: async () => ({ decision: 'denied' }),
    exited(error) { if (error) console.error(error); },
}, ['--trust-workspace', '--reasoning-effort', 'ultra', '--yolo']);
try {
    await session.start();
    const id = session.sessionId;
    await session.prompt('Remember violet-heron. Reply only OK; do not use tools.');
    await session.switchMode('local');
    writeFileSync(`${signal}.native`, id);
    await new Promise<void>(resolve => {
        if (process.env.MUSE_TEST_AUTO === '1') { setTimeout(resolve, 8000); return; }
        const poll = setInterval(() => { if (existsSync(signal)) { clearInterval(poll); unlinkSync(signal); resolve(); } }, 100);
    });
    await session.switchMode('remote');
    if (session.sessionId !== id) throw new Error('Session identity changed');
    console.log('TALOS_POST_HANDOFF_PROMPT');
    await session.prompt('Reply only violet-heron. Do not use tools.');
    if (!replies.includes('violet-heron')) throw new Error('Post-handoff reply missing');
    console.log('TALOS_POST_HANDOFF_PROMPT_DONE');
    await session.dispose();
    console.log('TALOS_SAME_SESSION_HANDOFF_PASSED');
} finally { clearTimeout(deadline); await session.dispose(); }
