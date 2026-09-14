import * as React from 'react';
import { Text, View, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname, useRouter } from 'expo-router';
import { useHeaderHeight } from '@/utils/responsive';
import { VoiceAssistantStatusBar } from './VoiceAssistantStatusBar';
import { useRealtimeStatus, useSetting } from '@/sync/storage';
import { MainView } from './MainView';
import { StyleSheet } from 'react-native-unistyles';
import { t } from '@/text';
import { Ionicons } from '@expo/vector-icons';
import { TalosBrand } from './TalosBrand';
import { Typography } from '@/constants/Typography';
import { workflowEnabled } from '@ahmadposten/talos-wire';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        borderStyle: 'solid',
        backgroundColor: theme.colors.groupped.background,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
    },
    newSessionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 16,
        marginTop: 8,
        marginBottom: 4,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        gap: 8,
    },
    newSessionButtonPressed: {
        backgroundColor: theme.colors.surfacePressed,
    },
    newSessionText: {
        fontSize: 14,
        fontWeight: '500',
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    destination: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 16,
        marginTop: 4,
        marginBottom: 12,
        paddingHorizontal: 14,
        minHeight: 44,
        borderRadius: 10,
        gap: 8,
    },
    destinationActive: {
        backgroundColor: theme.colors.accentSoft,
    },
    destinationText: {
        flex: 1,
        fontSize: 14,
        color: theme.colors.textSecondary,
        ...Typography.default('semiBold'),
    },
    destinationTextActive: {
        color: theme.colors.accent,
    },
    settingsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
        gap: 10,
    },
    settingsText: {
        fontSize: 14,
        fontWeight: '500',
        color: theme.colors.text,
        ...Typography.default(),
    },
}));

export const SidebarView = React.memo(() => {
    const styles = stylesheet;
    const safeArea = useSafeAreaInsets();
    const router = useRouter();
    const headerHeight = useHeaderHeight();
    const realtimeStatus = useRealtimeStatus();
    const pathname = usePathname();
    const experiments = useSetting('experiments');
    const expWorkflows = useSetting('expWorkflows');
    const showWorkflows = workflowEnabled({ experiments, expWorkflows });
    const workflowsSelected = pathname === '/workflows' || pathname.startsWith('/workflows/');

    const handleNewSession = React.useCallback(() => {
        router.navigate('/new');
    }, [router]);

    return (
        <View style={[styles.container, { paddingTop: safeArea.top + headerHeight }]}>
            <View style={{ paddingHorizontal: 22, paddingTop: 8, paddingBottom: 20 }}><TalosBrand size={32} /></View>
            {/* New Session button */}
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('sidebar.newSession')}
                onPress={handleNewSession}
                style={({ pressed }) => [
                    styles.newSessionButton,
                    pressed && styles.newSessionButtonPressed,
                ]}
            >
                <Ionicons name="create-outline" size={16} color={stylesheet.newSessionText.color} />
                <Text style={styles.newSessionText}>{t('sidebar.newSession')}</Text>
            </Pressable>

            {showWorkflows && <Pressable
                accessibilityRole="button"
                accessibilityLabel="Workflows"
                accessibilityState={{ selected: workflowsSelected }}
                onPress={() => router.navigate('/workflows')}
                style={({ pressed }) => [styles.destination, workflowsSelected && styles.destinationActive, pressed && styles.newSessionButtonPressed]}
            >
                <Ionicons name="git-network-outline" size={18} color={workflowsSelected ? styles.destinationTextActive.color : styles.destinationText.color} />
                <Text style={[styles.destinationText, workflowsSelected && styles.destinationTextActive]}>Workflows</Text>
                <Ionicons name="chevron-forward" size={14} color={workflowsSelected ? styles.destinationTextActive.color : styles.destinationText.color} />
            </Pressable>}

            {realtimeStatus !== 'disconnected' && (
                <VoiceAssistantStatusBar variant="sidebar" />
            )}

            {/* Sessions list */}
            <MainView variant="sidebar" />

            {/* Settings at bottom */}
            <Pressable
                onPress={() => router.push('/settings')}
                style={styles.settingsRow}
            >
                <Ionicons name="settings-outline" size={18} color={stylesheet.settingsText.color} />
                <Text style={styles.settingsText}>{t('settings.title')}</Text>
            </Pressable>
        </View>
    );
});
