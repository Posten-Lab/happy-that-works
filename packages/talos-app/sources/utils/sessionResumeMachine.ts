import type { Machine, Session } from '@/sync/storageTypes';
import { isMachineOnline } from './machineUtils';

/** A migrated installation has a new daemon ID, but retains its host and OS
 * user. Only use an unambiguous live registration for that same environment.
 * Session host names can be Tailscale names, so compare machine metadata. */
export function resolveSessionResumeMachine(session: Session, machines: Record<string, Machine>): Machine | null {
    const original = machines[session.metadata?.machineId ?? ''];
    if (!original) return null;
    if (isMachineOnline(original)) return original;
    const source = original.metadata;
    if (!source?.host || !source.homeDir || !source.platform) return null;
    const candidates = Object.values(machines).filter(machine => {
        const target = machine.metadata;
        return isMachineOnline(machine)
            && target?.host === source.host
            && target.homeDir === source.homeDir
            && target.platform === source.platform
            && (!source.arch || !target.arch || target.arch === source.arch);
    });
    return candidates.length === 1 ? candidates[0] : null;
}
