import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MuseSession, type MuseSessionCallbacks } from './MuseSession';
import { museEffortLevels, type MuseControlState } from './museControls';
import { connectMuse } from './museClient';

describe('Muse controls real provider acceptance', () => {
    it('runs all eight effort choices and resumes the same model/history', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'talos-muse-efforts-'));
        const messages: string[] = [];
        let saved: MuseControlState | undefined;
        const store = { load: () => saved, save: (_id: string, state: MuseControlState) => { saved = structuredClone(state); } };
        const callbacks: MuseSessionCallbacks = { message: m => { if (m.data?.type === 'message') messages.push(m.data.message); },
            metadata() {}, mode() {}, activity() {}, notice() {}, permission: async () => ({ decision: 'denied' }), exited() {} };
        let session = new MuseSession(cwd, callbacks, [], undefined, store);
        try {
            await session.start();
            const id = session.sessionId;
            for (const effort of museEffortLevels) {
                messages.length = 0;
                await session.prompt('The code word is violet-heron. Reply only violet-heron. Do not use tools.', { effort });
                expect(messages.join('\n')).toContain('violet-heron');
                expect(saved?.effort).toBe(effort);
                await session.dispose();
                session = new MuseSession(cwd, callbacks, [], undefined, store);
                await session.start(id);
                expect(session.sessionId).toBe(id);
                console.log(`Muse effort ${effort}: real inference and durable resume passed`);
            }
            messages.length = 0;
            await session.prompt('What was the code word? Reply only with it. Do not use tools.');
            expect(messages.join('\n')).toContain('violet-heron');
        } finally { await session.dispose(); rmSync(cwd, { recursive: true, force: true }); }
    }, 480000);

    it('changes all approval modes, keeps the native identity through YOLO host restarts, and preserves controls on resume', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'talos-muse-all-approvals-'));
        let approvals = 0;
        let saved: MuseControlState | undefined;
        const store = { load: () => saved, save: (_id: string, state: MuseControlState) => { saved = structuredClone(state); } };
        const callbacks: MuseSessionCallbacks = { message() {}, metadata() {}, mode() {}, activity() {}, notice() {}, exited() {},
            permission: async () => { approvals++; return { decision: 'denied' }; } };
        let session = new MuseSession(cwd, callbacks, [], undefined, store);
        try {
            await session.start();
            const id = session.sessionId;
            for (const [mode, native] of [['default', 'promptUnmatched'], ['safe-yolo', 'onRequest'], ['never', 'denyUnmatched'], ['bypassPermissions', 'allowAll'], ['yolo', 'allowAll'], ['default', 'promptUnmatched']]) {
                await session.prompt('Reply only OK. Do not use tools.', { permissionMode: mode, effort: 'low' });
                expect(session.sessionId).toBe(id);
                const observer = await connectMuse(cwd);
                try {
                    const r = await observer.connection.request('session/read', { sessionId: id, excludeItems: true });
                    expect((r.session as any).approvalMode.mode).toBe(native);
                } finally { await observer.close(); }
                console.log(`Muse approval ${mode}: native ${native}, same session identity`);
            }
            const before = approvals;
            await session.prompt('Use the shell tool to write exactly violet-heron to yolo.txt. Do not ask a separate question.', { permissionMode: 'yolo', effort: 'low' });
            expect(approvals).toBe(before);
            expect(readFileSync(join(cwd, 'yolo.txt'), 'utf8')).toBe('violet-heron');
            await session.dispose();
            session = new MuseSession(cwd, callbacks, [], undefined, store);
            await session.start(id);
            expect(saved?.permissionMode).toBe('yolo');
            await session.prompt('Use the shell tool to write exactly blocked to denied.txt. If denied, stop without retrying.', { permissionMode: 'never', effort: 'low' });
            expect(approvals).toBe(before);
            expect(existsSync(join(cwd, 'denied.txt'))).toBe(false);
        } finally { await session.dispose(); rmSync(cwd, { recursive: true, force: true }); }
    }, 480000);
});
