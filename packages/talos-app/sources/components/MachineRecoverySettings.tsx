import * as React from 'react';
import { ActivityIndicator } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Item } from './Item';
import { ItemGroup } from './ItemGroup';
import { Switch } from './Switch';
import type { Machine, Session } from '@/sync/storageTypes';
import { machineSetSessionRecovery } from '@/sync/ops';
import { sync } from '@/sync/sync';
import { Modal } from '@/modal';
import { t } from '@/text';
import { getMachineRecovery } from '@/utils/sessionRecovery';
import { isMachineOnline } from '@/utils/machineUtils';
import { getSessionName } from '@/utils/sessionUtils';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';

export function MachineRecoverySettings({ machine, sessions }: { machine: Machine; sessions: Session[] }) {
    const { theme } = useUnistyles();
    const navigateToSession = useNavigateToSession();
    const recovery = getMachineRecovery(machine.daemonState);
    const [saving, setSaving] = React.useState(false);
    const [savedEnabled, setSavedEnabled] = React.useState<boolean | null>(null);
    React.useEffect(() => setSavedEnabled(null), [recovery?.enabled, machine.id]);

    if (!recovery) return null;
    const online = isMachineOnline(machine);
    const enabled = savedEnabled ?? recovery.enabled;
    const handleChange = async (value: boolean) => {
        if (saving || !online) return;
        setSaving(true);
        try {
            const result = await machineSetSessionRecovery(machine.id, value);
            setSavedEnabled(result.enabled);
            await sync.refreshMachines();
        } catch {
            Modal.alert(t('common.error'), t('sessionRecovery.updateFailed'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <ItemGroup title={t('sessionRecovery.title')} footer={online ? t('sessionRecovery.description') : t('sessionRecovery.offlineSettings')}>
            <Item
                title={t('sessionRecovery.automaticRestore')}
                showChevron={false}
                rightElement={saving ? <ActivityIndicator size="small" color={theme.colors.textSecondary} /> : (
                    <Switch
                        accessibilityLabel={t('sessionRecovery.automaticRestore')}
                        value={enabled}
                        disabled={!online}
                        onValueChange={handleChange}
                    />
                )}
            />
            {recovery.sessions.map(result => {
                const session = sessions.find(candidate => candidate.id === result.sessionId);
                // Archived/deleted sessions can remain in a previous daemon snapshot.
                if (session?.metadata?.lifecycleState === 'archived') return null;
                const status = (result.status === 'pending' || result.status === 'restoring') && !enabled
                    ? t('sessionRecovery.paused')
                    : (result.status === 'pending' || result.status === 'restoring') && !online
                        ? t('sessionRecovery.waitingForMachine')
                        : t(`sessionRecovery.${result.status}`);
                return (
                    <Item
                        key={result.sessionId}
                        title={session ? getSessionName(session) : t('machine.untitledSession')}
                        subtitle={result.status === 'failed' ? [status, result.error, t('sessionRecovery.retryHint')].filter(Boolean).join('\n') : status}
                        subtitleLines={0}
                        onPress={session ? () => navigateToSession(result.sessionId) : undefined}
                        showChevron={!!session}
                    />
                );
            })}
        </ItemGroup>
    );
}
