import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Machine, Session } from './storageTypes';
const ops = vi.hoisted(() => ({ machineResumeSession: vi.fn(), machineSpawnNewSession: vi.fn() }));
vi.mock('./ops', () => ops);
import { resumeArchivedSession } from './resumeArchivedSession';
const session = { id: 'archive', metadata: { machineId: 'host', path: '/project', flavor: 'codex', codexThreadId: 'thread' } } as Session;
const machines = { host: { id: 'host', active: true } as Machine };
beforeEach(() => vi.resetAllMocks());
describe('resume archived conversation', () => {
    it('reconnects the original session with its selected modes', async () => {
        ops.machineResumeSession.mockResolvedValue({ type: 'success', sessionId: 'archive' });
        expect(await resumeArchivedSession(session, { model: 'chosen', permissionMode: 'read-only' }, machines)).toEqual({ type: 'success', sessionId: 'archive' });
        expect(ops.machineResumeSession).toHaveBeenCalledWith({ machineId: 'host', sessionId: 'archive', model: 'chosen', permissionMode: 'read-only' });
        expect(ops.machineSpawnNewSession).not.toHaveBeenCalled();
    });
    it.each(['codex', 'claude'])('resumes pre-recovery %s provider history on its original host', async agent => {
        ops.machineResumeSession.mockResolvedValue({ type: 'error', errorMessage: 'Session recovery data is unavailable on this machine.' });
        ops.machineSpawnNewSession.mockResolvedValue({ type: 'success', sessionId: 'continued' });
        const archived = { ...session, metadata: { ...session.metadata, flavor: agent, codexThreadId: agent === 'codex' ? 'thread' : undefined, claudeSessionId: agent === 'claude' ? 'claude-id' : undefined } } as Session;
        expect(await resumeArchivedSession(archived, {}, machines)).toEqual({ type: 'success', sessionId: 'continued' });
        expect(ops.machineSpawnNewSession).toHaveBeenCalledWith({ machineId: 'host', directory: '/project', agent, parentSessionId: 'archive', ...(agent === 'codex' ? { resumeCodexThreadId: 'thread' } : { resumeClaudeSessionId: 'claude-id' }) });
    });
    it('routes both recovery and provider-history fallback to the replacement registration', async () => {
        const metadata = { host: 'Mac.local', homeDir: '/Users/person', platform: 'darwin' };
        const migrated = { host: { id: 'host', active: false, metadata } as Machine, current: { id: 'current', active: true, metadata } as Machine };
        ops.machineResumeSession.mockResolvedValue({ type: 'error', errorMessage: 'Session recovery data is unavailable on this machine.' });
        ops.machineSpawnNewSession.mockResolvedValue({ type: 'success', sessionId: 'continued' });
        await resumeArchivedSession(session, {}, migrated);
        expect(ops.machineResumeSession).toHaveBeenCalledWith({ machineId: 'current', sessionId: 'archive' });
        expect(ops.machineSpawnNewSession).toHaveBeenCalledWith(expect.objectContaining({ machineId: 'current', resumeCodexThreadId: 'thread' }));
    });
    it('rechecks machine availability before launching', async () => {
        expect(await resumeArchivedSession(session, {}, { host: { ...machines.host, active: false } })).toMatchObject({ type: 'error' });
        expect(ops.machineResumeSession).not.toHaveBeenCalled();
        expect(ops.machineSpawnNewSession).not.toHaveBeenCalled();
    });
    it.each(['Request timed out', 'Machine offline', 'This session belongs to another machine or server.', 'This session has been deleted.'])('does not launch another agent after %s', async errorMessage => {
        ops.machineResumeSession.mockResolvedValue({ type: 'error', errorMessage });
        expect(await resumeArchivedSession(session, {}, machines)).toEqual({ type: 'error', errorMessage });
        expect(ops.machineSpawnNewSession).not.toHaveBeenCalled();
    });
});
