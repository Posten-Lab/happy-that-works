import { startTalosServer } from '../../src/claude/utils/startTalosServer';
import type { ApiSessionClient } from '../../src/api/apiSession';
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { MuseSession } from '../../src/muse/MuseSession';
if (process.env.MUSE_TEST_ROOT) process.chdir(process.env.MUSE_TEST_ROOT + '/packages/talos-cli');
const signal = process.env.MUSE_TEST_SIGNAL || '/tmp/talos-muse-manual-handoff';
const deadline = setTimeout(() => { void session.dispose().finally(() => process.exit(1)); }, 180000);
const replies: string[] = [];
const titles: string[] = [];
const plans: unknown[] = [];
const server = await startTalosServer({ sessionId: 'handoff-evidence', sendClaudeSessionMessage(m: {summary: string}) { titles.push(m.summary); } } as unknown as ApiSessionClient);
const session = new MuseSession(process.cwd(), {
    message(m) { if (m.data?.type === 'message') replies.push(m.data.message); if (m.data?.type === 'tool-result' && typeof m.data.output === 'object' && m.data.output !== null && 'newTodos' in m.data.output) plans.push(m.data.output.newTodos); }, metadata() {}, activity() {}, notice: console.error,
    mode(mode) { if (mode === 'remote') console.log('TALOS_REMOTE_READY'); },
    permission: async () => ({ decision: 'denied' }),
    exited(error) { if (error) console.error(error); },
}, ['--trust-workspace', '--reasoning-effort', 'ultra', '--yolo'], undefined, undefined, server.url);
try {
    await session.start();
    const id = session.sessionId;
    await session.prompt('Use write_todos to create one task: Verify handoff, in progress. Then reply OK.');
    await session.switchMode('local');
    writeFileSync(`${signal}.native`, id);
    await new Promise<void>(resolve => {
        if (process.env.MUSE_TEST_AUTO === '1') { setTimeout(resolve, 8000); return; }
        const poll = setInterval(() => { if (existsSync(signal)) { clearInterval(poll); unlinkSync(signal); resolve(); } }, 100);
    });
    await session.switchMode('remote');
    if (session.sessionId !== id) throw new Error('Session identity changed');
    console.log('TALOS_POST_HANDOFF_PROMPT');
    await session.prompt('Rename this chat to Muse Handoff Verified using the Talos title tool. Use write_todos to mark Verify handoff completed. Then reply only violet-heron.');
    if (!replies.includes('violet-heron')) throw new Error('Post-handoff reply missing');
    if (!titles.includes('Muse Handoff Verified')) throw new Error('Post-handoff title missing');
    if (JSON.stringify(plans.at(-1)) !== JSON.stringify([{content: 'Verify handoff', status: 'completed'}])) throw new Error('Post-handoff todo missing');
    console.log('TALOS_POST_HANDOFF_TOOLS_PASSED');
    await session.dispose();
    console.log('TALOS_SAME_SESSION_HANDOFF_PASSED');
} finally { clearTimeout(deadline); await session.dispose(); server.stop(); }
