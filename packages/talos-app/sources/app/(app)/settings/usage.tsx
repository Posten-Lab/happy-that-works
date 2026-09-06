import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { AccountUsageDashboard } from '@/components/usage/AccountUsageDashboard';
import { UsagePanel } from '@/components/usage/UsagePanel';
import { ItemList } from '@/components/ItemList';
import { Text } from '@/components/StyledText';
import { useProviderUsage } from '@/hooks/useProviderUsage';

const styles = StyleSheet.create((theme) => ({
    history: { width: '100%', maxWidth: 1080, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 32 },
    card: { borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 18, backgroundColor: theme.colors.surface, overflow: 'hidden' },
    toggle: { padding: 20, flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 76 },
    title: { color: theme.colors.text, fontSize: 15, lineHeight: 22, fontWeight: '500' },
    description: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 3 },
    explanation: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 19, paddingHorizontal: 20, paddingBottom: 8 },
}));

export default function UsageSettingsScreen() {
    const usage = useProviderUsage();
    const { theme } = useUnistyles();
    const [historyExpanded, setHistoryExpanded] = React.useState(false);
    return (
        <ItemList style={{ paddingTop: 0 }}>
            <AccountUsageDashboard {...usage} />
            <View style={styles.history}>
                <View style={styles.card}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ expanded: historyExpanded }}
                        accessibilityLabel="Talos activity history"
                        onPress={() => setHistoryExpanded(value => !value)}
                        style={({ pressed }) => [styles.toggle, pressed && { backgroundColor: theme.colors.surfacePressed }]}
                    >
                        <Ionicons name="bar-chart-outline" size={21} color={theme.colors.accent} />
                        <View style={{ flex: 1 }}>
                            <Text style={styles.title}>Talos activity history</Text>
                            <Text style={styles.description}>Recorded tokens and estimated API costs</Text>
                        </View>
                        <Ionicons name={historyExpanded ? 'chevron-up' : 'chevron-down'} size={17} color={theme.colors.textSecondary} />
                    </Pressable>
                    {historyExpanded && <>
                        <Text style={styles.explanation}>Activity recorded by Talos. Estimated API costs are informational and do not represent subscription charges or your remaining plan allowance.</Text>
                        <UsagePanel />
                    </>}
                </View>
            </View>
        </ItemList>
    );
}
