import type { Metadata } from '@/api/types';

/** Keep conversation metadata while replacing the fields describing the new local process. */
export function reconnectMetadata(current: Metadata, encoded = process.env.TALOS_RECONNECT_METADATA): Metadata {
    if (!encoded) return current;
    const saved: unknown = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Invalid recovery metadata');
    const present = Object.fromEntries(Object.entries(current).filter(([, value]) => value !== undefined));
    return {
        ...saved, ...present,
        lifecycleState: 'running', lifecycleStateSince: Date.now(), archivedBy: undefined, archiveReason: undefined,
    } as Metadata;
}
