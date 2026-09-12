import type { Session } from './storageTypes';
import type { Settings } from './settings';
import { getAgentDefaultOverride } from './agentDefaults';
import type { PermissionModeKey } from '@/components/PermissionModeSelector';

export type MessageModeMeta = {
    permissionMode?: PermissionModeKey;
    model?: string | null;
    effort?: string | null;
};

export function resolveMessageModeMeta(
    session: Pick<Session, 'permissionMode' | 'modelMode' | 'metadata' | 'effortLevel'>,
    settings?: Pick<Settings, 'agentDefaultOverrides'>,
): MessageModeMeta {
    const agentOverrides = getAgentDefaultOverride(settings?.agentDefaultOverrides, session.metadata?.flavor);
    const profile = session.metadata?.agentProfile;
    const meta: MessageModeMeta = profile ? {
        permissionMode: profile.permissionMode,
        model: profile.model,
        effort: profile.effort,
    } : {};

    if (session.permissionMode !== null && session.permissionMode !== undefined) {
        meta.permissionMode = session.permissionMode;
    } else if (!profile && agentOverrides.permissionMode !== undefined) {
        meta.permissionMode = agentOverrides.permissionMode;
    }

    const modelMode = session.modelMode ?? profile?.model ?? agentOverrides.modelMode;
    if (modelMode !== undefined) {
        meta.model = modelMode === 'default' ? null : modelMode;
    }

    const effort = session.effortLevel ?? (profile ? profile.effort : agentOverrides.effortLevel);
    if (effort !== undefined) {
        meta.effort = effort;
    }

    if (session.metadata?.flavor === 'muse') meta.model = null;
    return meta;
}

export function resolveSendMessageModeMeta(
    session: Pick<Session, 'permissionMode' | 'modelMode' | 'metadata' | 'effortLevel'>,
    settings?: Pick<Settings, 'agentDefaultOverrides'>,
    snapshot?: MessageModeMeta,
): MessageModeMeta {
    return {
        ...resolveMessageModeMeta(session, settings),
        ...snapshot,
        ...(session.metadata?.flavor === 'muse' ? { model: null } : {}),
    };
}
