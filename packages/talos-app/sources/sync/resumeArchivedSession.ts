import type { Session } from './storageTypes';
import { machineResumeSession, machineSpawnNewSession } from './ops';

/** Prefer reconnecting the original Talos session. Pre-recovery archives can
 * still resume their provider conversation through the daemon's spawn API. */
export async function resumeArchivedSession(session: Session, options: { model?: string; permissionMode?: string }) {
    const machineId = session.metadata?.machineId;
    if (!machineId) return { type: 'error' as const, errorMessage: 'This session has no saved machine.' };
    const result = await machineResumeSession({ machineId, sessionId: session.id, ...options });
    if (result.type !== 'error' || result.errorMessage !== 'Session recovery data is unavailable on this machine.') return result;

    const metadata = session.metadata;
    if (!metadata?.path || (!metadata.claudeSessionId && !metadata.codexThreadId)) return result;
    const agent = metadata.flavor === 'codex' || metadata.codexThreadId ? 'codex' : 'claude';
    // Never retry a timeout or an ambiguous launch failure: that could start a
    // second agent. This explicit error is returned before any process launches.
    return machineSpawnNewSession({
        machineId, directory: metadata.path, agent,
        ...(agent === 'codex' ? { resumeCodexThreadId: metadata.codexThreadId } : { resumeClaudeSessionId: metadata.claudeSessionId }),
        parentSessionId: session.id,
    });
}
