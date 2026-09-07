import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { MuseSession } from '../../src/muse/MuseSession';
if (process.env.MUSE_TEST_ROOT) process.chdir(process.env.MUSE_TEST_ROOT + '/packages/talos-cli');
const signal = process.env.MUSE_TEST_SIGNAL || '/tmp/talos-muse-manual-handoff';
const deadline = setTimeout(() => { void session.dispose().finally(() => process.exit(1)); }, 90000);
const session = new MuseSession(process.cwd(), {
    message() {}, metadata() {}, activity() {}, notice: console.error,
    mode(mode) { if (mode === 'remote') console.log('TALOS_REMOTE_READY'); },
    permission: async () => ({ decision: 'denied' }),
    exited(error) { if (error) console.error(error); },
}, ['--trust-workspace']);
try {
    await session.start();
    const id = session.sessionId;
    await session.switchMode('local');
    writeFileSync(`${signal}.native`, id);
    await new Promise<void>(resolve => {
        const poll = setInterval(() => { if (existsSync(signal)) { clearInterval(poll); unlinkSync(signal); resolve(); } }, 100);
    });
    await session.switchMode('remote');
    if (session.sessionId !== id) throw new Error('Session identity changed');
    await session.dispose();
    console.log('TALOS_SAME_SESSION_HANDOFF_PASSED');
} finally { clearTimeout(deadline); await session.dispose(); }
