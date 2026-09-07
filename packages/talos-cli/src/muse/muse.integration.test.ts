import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MuseSession, type MuseSessionCallbacks } from './MuseSession';
import { connectMuse, discoverMuseModels } from './museClient';

// Acceptance tests use the installed CLI and the user's authenticated Meta account.
// No provider, protocol, permission, or inference mocks.
describe('Muse Code real provider acceptance', () => {
    it('answers multiple turns, rejects model changes and resumes durable history', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'talos-muse-acceptance-'));
        const messages: string[] = [];
        const callbacks: MuseSessionCallbacks = {
            message: m => { if (m.data?.type === 'message') messages.push(m.data.message); },
            metadata() {}, mode() {}, activity() {}, notice() {},
            permission: async () => ({ decision: 'denied' }), exited() {},
        };
        let session = new MuseSession(cwd, callbacks);
        try {
            const models = await discoverMuseModels(cwd);
            expect(models.length).toBeGreaterThan(0);
            expect(models.map(m => m.code)).toEqual(['default']);
            const model = 'default';
            await session.start();
            await session.prompt('Remember the code word copper-otter. Reply only with that code word. Do not use tools.', { model });
            expect(messages.join('\n')).toContain('copper-otter');
            await expect(session.prompt('Do not submit this', { model: 'muse-spark-1.3' })).rejects.toThrow('temporarily disabled');
            const id = session.sessionId;
            await session.dispose();
            session = new MuseSession(cwd, callbacks);
            await session.start(id);
            messages.length = 0;
            await session.prompt('What was the code word? Reply only with it. Do not use tools.');
            expect(messages.join('\n')).toContain('copper-otter');
            expect(session.sessionId).toBe(id);
            await session.dispose();
            const native = await connectMuse(cwd);
            try {
                await native.connection.command('session/resume', { sessionId: id, history: 'inline' });
                for (const modelId of ['muse-spark-1.3', 'muse-spark-1.3-contributor']) {
                    await native.connection.command('session/setModel', { sessionId: id, model: { modelId, providerId: 'meta', profileId: null } });
                }
            } finally { await native.close(); }
            session = new MuseSession(cwd, callbacks);
            await expect(session.start(id)).rejects.toThrow('temporarily disabled');
        } finally { await session.dispose(); rmSync(cwd, { recursive: true, force: true }); }
    }, 360000);

    it('routes real approvals, interrupts work, and rejects unsupported permission modes', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'talos-muse-permissions-'));
        let approvals = 0;
        let allow = false;
        let started: (() => void) | undefined;
        const callbacks: MuseSessionCallbacks = { message() {}, metadata() {}, mode() {}, notice() {}, exited() {},
            activity: active => { if (active) started?.(); },
            permission: async () => { approvals++; return { decision: allow ? 'approved' : 'denied' }; } };
        const session = new MuseSession(cwd, callbacks);
        try {
            await session.start();
            await expect(session.prompt('hello', { permissionMode: 'read-only' })).rejects.toThrow('Unsupported');
            await session.prompt('Run a shell command to write blocked.txt containing blocked. Ask for approval, and do not retry after denial.', { permissionMode: 'default' });
            expect(approvals).toBeGreaterThan(0);
            expect(existsSync(join(cwd, 'blocked.txt'))).toBe(false);
            allow = true;
            const deniedApprovals = approvals;
            await session.prompt('Run a shell command to write approved.txt containing exactly copper-otter. Request tool permission as needed, without asking a separate question.', { permissionMode: 'default' });
            expect(approvals).toBeGreaterThan(deniedApprovals);
            expect(readFileSync(join(cwd, 'approved.txt'), 'utf8')).toBe('copper-otter');
            const active = new Promise<void>(resolve => { started = resolve; });
            const turn = session.prompt('Explain the integers from 1 to 1000 in detail. Do not use tools.');
            void turn.catch(() => {});
            await active;
            await session.cancel();
            await turn;
        } finally { await session.dispose(); rmSync(cwd, { recursive: true, force: true }); }
    }, 360000);
    it('cancels a live admitted turn and releases its durable session', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'talos-muse-cancel-'));
        let markStarted: () => void = () => {};
        const started = new Promise<void>(resolve => { markStarted = resolve; });
        const callbacks: MuseSessionCallbacks = { message() {}, metadata() {}, mode() {}, notice() {}, exited() {},
            activity: active => { if (active) markStarted(); }, permission: async () => ({ decision: 'denied' }) };
        let session = new MuseSession(cwd, callbacks);
        try {
            await session.start();
            const id = session.sessionId;
            const turn = session.prompt('Count from 1 to 1000. Do not use tools.');
            void turn.catch(() => {});
            await started;
            await session.cancel();
            await turn;
            await session.dispose();
            session = new MuseSession(cwd, callbacks);
            await session.start(id);
            expect(session.sessionId).toBe(id);
            await expect(session.prompt('hello', { model: 'talos-nonexistent-model' })).rejects.toThrow();
        } finally { await session.dispose(); rmSync(cwd, { recursive: true, force: true }); }
    }, 60000);

});
