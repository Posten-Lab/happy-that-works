import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { MuseSession, type MuseSessionCallbacks } from '../../src/muse/MuseSession';
const cwd = await mkdtemp(join(tmpdir(), 'talos-muse-completion-'));
const previousCli = process.env.MUSE_CLI;
process.env.MUSE_RECOVERY_REAL_CLI = previousCli ?? join(homedir(), '.local/bin/muse');
process.env.MUSE_RECOVERY_DROP_LOG = join(cwd, 'dropped.log');
process.env.MUSE_CLI = fileURLToPath(new URL('./drop-notifications-proxy.mjs', import.meta.url));
const replies: string[] = [];
const callbacks: MuseSessionCallbacks = {
    message(m) { if (m.data?.type === 'message') { replies.push(m.data.message); console.log('RECOVERED_REPLY', m.data.message); } },
    metadata() {}, mode() {}, activity(active) { console.log('ACTIVITY', active); },
    notice: console.error, permission: async () => ({ decision: 'denied' }), exited() {},
};
const session = new MuseSession(cwd, callbacks);
const deadline = setTimeout(() => { console.error('Recovery timed out'); void session.dispose().finally(() => process.exit(1)); }, 180000);
try {
    await session.start(); // Must be a fresh session: the original regression.
    const id = session.sessionId;
    const first = session.prompt('Reply exactly amber-572-heron. Do not use tools.', { effort: 'low' });
    // Simulate a queued follow-up waiting for the first prompt to settle.
    const second = first.then(() => session.prompt('Reply exactly violet-639-otter. Do not use tools.', { effort: 'low' }));
    await second;
    assert.equal(session.sessionId, id);
    assert.equal(replies.filter(r => r.includes('amber-572-heron')).length, 1);
    assert.equal(replies.filter(r => r.includes('violet-639-otter')).length, 1);
    const dropped = (await readFile(process.env.MUSE_RECOVERY_DROP_LOG, 'utf8')).trim().split('\n');
    assert.equal(dropped.filter(m => m === 'turn/completed').length, 2);
    assert(dropped.includes('item/completed'));
    console.log('MUSE_FRESH_SESSION_DROPPED_COMPLETIONS_RECOVERED', JSON.stringify({ sessionId: id, replies: replies.length, droppedNotifications: dropped.length }));
} finally {
    clearTimeout(deadline); await session.dispose(); await rm(cwd, { recursive: true, force: true });
    if (previousCli === undefined) delete process.env.MUSE_CLI; else process.env.MUSE_CLI = previousCli;
    delete process.env.MUSE_RECOVERY_REAL_CLI; delete process.env.MUSE_RECOVERY_DROP_LOG;
}
