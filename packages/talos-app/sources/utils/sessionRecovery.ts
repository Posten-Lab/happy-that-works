import { z } from 'zod';

const SessionRecoverySchema = z.object({
    sessionId: z.string(),
    status: z.enum(['pending', 'restoring', 'restored', 'failed']),
    attempts: z.number(),
    error: z.string().optional(),
    updatedAt: z.number(),
});

const MachineRecoverySchema = z.object({
    enabled: z.boolean(),
    sessions: z.array(SessionRecoverySchema),
});

export type SessionRecovery = z.infer<typeof SessionRecoverySchema>;

/** Older daemons do not advertise recovery, so their controls stay hidden. */
export function getMachineRecovery(daemonState: unknown) {
    if (!daemonState || typeof daemonState !== 'object' || !('recovery' in daemonState)) return null;
    const result = MachineRecoverySchema.safeParse(daemonState.recovery);
    return result.success ? result.data : null;
}

export function getSessionRecovery(daemonState: unknown, sessionId: string, lifecycleState?: string) {
    if (lifecycleState === 'archived') return undefined;
    return getMachineRecovery(daemonState)?.sessions.find(result => result.sessionId === sessionId);
}

/** The daemon has confirmed this process is missing; presence may lag behind. */
export function hasUnresolvedSessionRecovery(recovery: SessionRecovery | undefined): boolean {
    return !!recovery && recovery.status !== 'restored';
}
