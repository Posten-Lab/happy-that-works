import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Session } from '@/sync/storageTypes';
import { TodoChecklistRows } from '@/components/tools/views/TodoChecklistRows';
import { t } from '@/text';

/**
 * The session's todo list, pinned above the input.
 *
 * happy-cli folds each agent's task tooling (Claude's TaskCreate/TaskUpdate/
 * TaskList, Codex's plan) into one whole-list TodoWrite, so this only ever
 * renders a finished list — no agent-specific logic here.
 *
 * Renders TodoChecklistRows — the same rows the inline checklist used, kept in
 * a dependency-free module because importing them via TodoView pulled the whole
 * tool-view registry into a require cycle that blanked the rows on device.
 */
export const SessionTaskPanel = React.memo<{ session: Session }>(({ session }) => {
    const [expanded, setExpanded] = React.useState(false);
    const todos = session.todos ?? [];

    const { done, active, upNext } = React.useMemo(() => ({
        done: todos.filter((todo) => todo.status === 'completed').length,
        active: todos.filter((todo) => todo.status === 'in_progress'),
        upNext: todos.filter((todo) => todo.status === 'pending'),
    }), [todos]);

    if (todos.length === 0) {
        return null;
    }

    // Collapsed shows what is being worked on, falling back to what is next, so
    // the panel always says something without swallowing the chat.
    const COLLAPSED_MAX = 3;
    const collapsedSource = active.length > 0 ? active : upNext.slice(0, 1);
    const visible = expanded ? todos : collapsedSource.slice(0, COLLAPSED_MAX);
    const hidden = expanded ? 0 : collapsedSource.length - visible.length;

    return (
        <View style={styles.container}>
            <Pressable style={styles.header} onPress={() => setExpanded((v) => !v)} hitSlop={8}>
                <Ionicons name="bulb-outline" size={16} style={styles.headerIcon} />
                <Text style={styles.headerTitle} numberOfLines={1}>{t('tools.names.todoList')}</Text>
                <Text style={styles.headerCount}>{`${done}/${todos.length}`}</Text>
                <Ionicons name={expanded ? 'chevron-down' : 'chevron-up'} size={14} style={styles.headerIcon} />
            </Pressable>
            <TodoChecklistRows items={visible} />
            {hidden > 0 && (
                <Pressable onPress={() => setExpanded(true)} hitSlop={8}>
                    <Text style={styles.more}>{`+${hidden} more`}</Text>
                </Pressable>
            )}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        backgroundColor: theme.colors.surfaceHigh,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
        paddingBottom: 6,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    headerIcon: {
        color: theme.colors.textSecondary,
    },
    headerTitle: {
        flex: 1,
        fontSize: 14,
        fontWeight: '600',
        color: theme.colors.text,
    },
    headerCount: {
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    more: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        paddingHorizontal: 16,
        paddingTop: 2,
    },
}));
