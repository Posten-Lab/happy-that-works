import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Session } from '@/sync/storageTypes';
import { t } from '@/text';

/**
 * Persistent task checklist for the session.
 *
 * The inline tool views only appear where a task call sits in the transcript,
 * which used to be everywhere (TodoWrite fired on every change) but is now
 * sparse — Claude Code 2.1.170+ calls TaskCreate/TaskUpdate only when something
 * actually changes. This panel keeps the current list visible regardless of
 * scroll position, which is the "what is being worked on" indicator.
 *
 * Collapsed it shows the in-progress items; expanded it shows the whole list.
 */
export const SessionTaskPanel = React.memo<{ session: Session }>(({ session }) => {
    const [expanded, setExpanded] = React.useState(false);
    const todos = session.todos ?? [];

    const { done, active } = React.useMemo(() => ({
        done: todos.filter((todo) => todo.status === 'completed').length,
        active: todos.filter((todo) => todo.status === 'in_progress'),
    }), [todos]);

    if (todos.length === 0) {
        return null;
    }

    // Collapsed shows what is being worked on; if nothing is active, the panel
    // is just the progress header until tapped.
    const visible = expanded ? todos : active;

    return (
        <Pressable style={styles.container} onPress={() => setExpanded((v) => !v)}>
            <View style={styles.header}>
                <Ionicons name="checkmark-done-outline" size={16} style={styles.headerIcon} />
                <Text style={styles.headerTitle} numberOfLines={1}>
                    {t('tools.names.todoList')}
                </Text>
                <Text style={styles.headerCount}>{`${done}/${todos.length}`}</Text>
                <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} style={styles.headerIcon} />
            </View>
            {visible.length > 0 && (
                <View style={styles.list}>
                    {visible.map((todo, index) => {
                        const isCompleted = todo.status === 'completed';
                        const isInProgress = todo.status === 'in_progress';
                        return (
                            <View key={todo.id ?? `task-${index}`} style={styles.row}>
                                <Text style={styles.rowIcon}>{isCompleted ? '☑' : '☐'}</Text>
                                <Text
                                    style={[
                                        styles.rowText,
                                        isCompleted && styles.rowTextCompleted,
                                        isInProgress && styles.rowTextActive,
                                    ]}
                                    numberOfLines={expanded ? 3 : 1}
                                >
                                    {todo.content}
                                </Text>
                            </View>
                        );
                    })}
                </View>
            )}
        </Pressable>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        backgroundColor: theme.colors.surfaceHigh,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    headerIcon: {
        color: theme.colors.textSecondary,
    },
    headerTitle: {
        flex: 1,
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.text,
    },
    headerCount: {
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    list: {
        marginTop: 6,
        gap: 3,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 6,
    },
    rowIcon: {
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    rowText: {
        flex: 1,
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    rowTextActive: {
        color: theme.colors.text,
        fontWeight: '500',
    },
    rowTextCompleted: {
        color: theme.colors.success,
        textDecorationLine: 'line-through',
    },
}));
