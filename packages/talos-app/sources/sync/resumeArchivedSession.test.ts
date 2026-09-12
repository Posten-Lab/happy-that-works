import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Session } from './storageTypes';
const ops = vi.hoisted(() => ({ machineResumeSession: vi.fn(), machineSpawnNewSession: vi.fn() }));
vi.mock('./ops', () => ops);
import { resumeArchivedSession } from './resumeArchivedSession';
const session = { id: 'archive', metadata: { machineId: 'host', path: '/project', flavor: 'codex', codexThreadId: 'thread' } } as Session;
beforeEach(() => vi.resetAllMocks());
describe('resume archived conversation', () => {
    it('reconnects the original session with its selected modes', async () => {
        ops.machineResumeSession.mockResolvedValue({ type: 'success', sessionId: 'archive' });
        expect(await resumeArchivedSession(session, { model: 'chosen', permissionMode: 'read-only' })).toEqual({ type: 'success', sessionId: 'archive' });
        expect(ops.machineResumeSession).toHaveBeenCalledWith({ machineId: 'host', sessionId: 'archive', model: 'chosen', permissionMode: 'read-only' });
        expect(ops.machineSpawnNewSession).not.toHaveBeenCalled();
    });
    it.each(['codex', 'claude'])('resumes pre-recovery %s provider history on its original host', async agent => {
        ops.machineResumeSession.mockResolvedValue({ type: 'error', errorMessage: 'Session recovery data is unavailable on this machine.' });
        ops.machineSpawnNewSession.mockResolvedValue({ type: 'success', sessionId: 'continued' });
        const archived = { ...session, metadata: { ...session.metadata, flavor: agent, codexThreadId: agent === 'codex' ? 'thread' : undefined, claudeSessionId: agent === 'claude' ? 'claude-id' : undefined } } as Session;
        expect(await resumeArchivedSession(archived, {})).toEqual({ type: 'success', sessionId: 'continued' });
        expect(ops.machineSpawnNewSession).toHaveBeenCalledWith({ machineId: 'host', directory: '/project', agent, parentSessionId: 'archive', ...(agent === 'codex' ? { resumeCodexThreadId: 'thread' } : { resumeClaudeSessionId: 'claude-id' }) });
    });
    it.each(['Request timed out', 'Machine offline', 'This session belongs to another machine or server.', 'This session has been deleted.'])('does not launch another agent after %s', async errorMessage => {
        ops.machineResumeSession.mockResolvedValue({ type: 'error', errorMessage });
        expect(await resumeArchivedSession(session, {})).toEqual({ type: 'error', errorMessage });
        expect(ops.machineSpawnNewSession).not.toHaveBeenCalled();
    });
});
