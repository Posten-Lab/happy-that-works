import * as React from 'react';
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { AgentContentView } from '@/components/AgentContentView';
import { SessionTaskPanel } from '@/-session/SessionTaskPanel';
import { Session } from '@/sync/storageTypes';

/**
 * Placement check for the session task panel.
 *
 * Mirrors SessionView's composition exactly — the same AgentContentView, the
 * same `content` fragment shape (a flex:1 chat area followed by the panel) and
 * an input below — so the panel's position can be seen without a live session.
 * ChatList's root is `<View style={{flex:1}}>`, which the stand-in reproduces.
 */

const SESSION = {
    id: 'preview',
    todos: [
        { id: '1', content: 'Phase 0 — Plan + design spec + approval', status: 'completed' as const },
        { id: '4', content: 'Phase 3 — UI review panel (Codex, 3 lenses, cap 5)', status: 'in_progress' as const },
        { id: '5', content: 'Phase 4 — Correctness review (Codex alignment + adversarial)', status: 'in_progress' as const },
        { id: '6', content: 'Phase 5 — All-suites-green + open both PRs [blocked by #4, #5]', status: 'pending' as const },
    ],
} as unknown as Session;

export default React.memo(function TaskPanelPlacement() {
    const content = (
        <>
            {/* stand-in for ChatList, which is also flex:1 */}
            <View style={styles.chat}>
                <Text style={styles.chatText}>chat area (flex: 1)</Text>
                <Text style={styles.chatText}>the panel must sit BELOW this…</Text>
            </View>
            <SessionTaskPanel session={SESSION} />
        </>
    );

    const input = (
        <View style={styles.input}>
            <Text style={styles.inputText}>…and ABOVE this input</Text>
        </View>
    );

    return (
        <View style={styles.screen}>
            <AgentContentView content={content} input={input} />
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    screen: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    chat: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
    },
    chatText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    input: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        paddingVertical: 18,
        paddingHorizontal: 12,
    },
    inputText: {
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
}));
