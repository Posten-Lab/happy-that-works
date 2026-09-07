import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MuseSession, type MuseSessionCallbacks } from './MuseSession';
import { discoverMuseModels } from './museClient';

// Acceptance tests use the installed CLI and the user's authenticated Meta account.
// No provider, protocol, permission, or inference mocks.
describe('Muse Code real provider acceptance', () => {
    it('answers multiple turns, changes model and resumes durable history', async () => {
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
            const model = models.find(m => !m.code.includes('contributor'))!.code;
            await session.start();
            await session.prompt('Remember the code word copper-otter. Reply only with that code word. Do not use tools.', { model });
            expect(messages.join('\n')).toContain('copper-otter');
            const id = session.sessionId;
            await session.dispose();
            session = new MuseSession(cwd, callbacks);
            await session.start(id);
            messages.length = 0;
            await session.prompt('What was the code word? Reply only with it. Do not use tools.');
            expect(messages.join('\n')).toContain('copper-otter');
            expect(session.sessionId).toBe(id);
        } finally { await session.dispose(); rmSync(cwd, { recursive: true, force: true }); }
    }, 360000);

    it('routes real approvals, interrupts work, and rejects unsupported permission modes', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'talos-muse-permissions-'));
        let approvals = 0;
        let started: (() => void) | undefined;
        const callbacks: MuseSessionCallbacks = { message() {}, metadata() {}, mode() {}, notice() {}, exited() {},
            activity: active => { if (active) started?.(); },
            permission: async () => { approvals++; return { decision: 'denied' }; } };
        const session = new MuseSession(cwd, callbacks);
        try {
            await session.start();
            await expect(session.prompt('hello', { permissionMode: 'read-only' })).rejects.toThrow('Unsupported');
            await session.prompt('Run a shell command to write blocked.txt containing blocked. Ask for approval, and do not retry after denial.', { permissionMode: 'default' });
            expect(approvals).toBeGreaterThan(0);
            expect(existsSync(join(cwd, 'blocked.txt'))).toBe(false);
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
