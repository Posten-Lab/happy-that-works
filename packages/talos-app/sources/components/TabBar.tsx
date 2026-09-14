import * as React from 'react';
import { View, Pressable, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { t } from '@/text';
import { Typography } from '@/constants/Typography';
import { layout } from '@/components/layout';
import { useInboxHasContent } from '@/hooks/useInboxHasContent';
import { useSetting } from '@/sync/storage';
import { workflowEnabled } from '@ahmadposten/talos-wire';

export type TabType = 'inbox' | 'sessions' | 'workflows' | 'settings';

interface TabBarProps {
    activeTab: TabType;
    onTabPress: (tab: TabType) => void;
    inboxBadgeCount?: number;
}

const styles = StyleSheet.create((theme) => ({
    outerContainer: {
        backgroundColor: theme.colors.surface,
        borderTopWidth: 1,
        borderTopColor: theme.colors.divider,
    },
    innerContainer: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        alignItems: 'flex-start',
        maxWidth: layout.maxWidth,
        width: '100%',
        alignSelf: 'center',
    },
    tab: {
        flex: 1,
        alignItems: 'center',
        paddingTop: 8,
        paddingBottom: 4,
    },
    tabContent: {
        alignItems: 'center',
        position: 'relative',
    },
    label: {
        fontSize: 11,
        marginTop: 4,
        ...Typography.default(),
    },
    labelActive: {
        color: theme.colors.accent,
        ...Typography.default('semiBold'),
    },
    labelInactive: {
        color: theme.colors.textSecondary,
    },
    badge: {
        position: 'absolute',
        top: -4,
        right: -8,
        backgroundColor: theme.colors.status.error,
        borderRadius: 8,
        minWidth: 16,
        height: 16,
        paddingHorizontal: 4,
        justifyContent: 'center',
        alignItems: 'center',
    },
    badgeText: {
        color: '#FFFFFF',
        fontSize: 10,
        ...Typography.default('semiBold'),
    },
    indicatorDot: {
        position: 'absolute',
        top: 0,
        right: -2,
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: theme.colors.text,
    },
}));

export const TabBar = React.memo(({ activeTab, onTabPress, inboxBadgeCount = 0 }: TabBarProps) => {
    const { theme } = useUnistyles();
    const insets = useSafeAreaInsets();
    const inboxHasContent = useInboxHasContent();
    const experiments = useSetting('experiments');
    const expWorkflows = useSetting('expWorkflows');
    const showWorkflows = workflowEnabled({ experiments, expWorkflows });

    const tabs: { key: TabType; icon: React.ComponentProps<typeof Ionicons>['name']; label: string }[] = React.useMemo(() => {
        return [
            { key: 'inbox', icon: 'file-tray-outline', label: t('tabs.inbox') },
            { key: 'sessions', icon: 'terminal-outline', label: t('tabs.sessions') },
            ...(showWorkflows ? [{ key: 'workflows' as const, icon: 'git-network-outline' as const, label: 'Workflows' }] : []),
            { key: 'settings', icon: 'settings-outline', label: t('tabs.settings') },
        ];
    }, [showWorkflows]);

    return (
        <View style={[styles.outerContainer, { paddingBottom: insets.bottom }]}>
            <View style={styles.innerContainer}>
                {tabs.map((tab) => {
                    const isActive = activeTab === tab.key;
                    
                    return (
                        <Pressable
                            key={tab.key}
                            accessibilityRole="tab"
                            aria-selected={isActive}
                            accessibilityState={{ selected: isActive }}
                            accessibilityLabel={tab.label}
                            style={styles.tab}
                            onPress={() => onTabPress(tab.key)}
                            hitSlop={8}
                        >
                            <View style={styles.tabContent}>
                                <View style={{ paddingHorizontal: 18, paddingVertical: 5, borderRadius: 12, backgroundColor: isActive ? theme.colors.accentSoft : 'transparent' }}>
                                    <Ionicons name={tab.icon} size={23} color={isActive ? theme.colors.accent : theme.colors.textSecondary} />
                                </View>
                                {tab.key === 'inbox' && inboxBadgeCount > 0 && (
                                    <View style={styles.badge}>
                                        <Text style={styles.badgeText}>
                                            {inboxBadgeCount > 99 ? '99+' : inboxBadgeCount}
                                        </Text>
                                    </View>
                                )}
                                {tab.key === 'inbox' && inboxHasContent && inboxBadgeCount === 0 && (
                                    <View style={styles.indicatorDot} />
                                )}
                            </View>
                            <Text style={[
                                styles.label,
                                isActive ? styles.labelActive : styles.labelInactive
                            ]}>
                                {tab.label}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
});
