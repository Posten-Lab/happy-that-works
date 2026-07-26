import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Session } from '@/sync/storageTypes';
import { t } from '@/text';

/**
 * Persistent task checklist, pinned at the end of the session above the input.
 *
 * TodoWrite used to carry the whole list on every call, so a checklist was
 * always sitting next to the newest message. Claude Code 2.1.170+ only calls
 * TaskCreate/TaskUpdate when something changes, so the last one can be hundreds
 * of messages back — this keeps the current state where the old one used to be.
 *
 * Collapsed it shows the in-progress items; expanded it shows the whole list.
 */
/**
 * A task the reducer knows only by id — created by a TaskUpdate whose TaskCreate
 * has not been back-filled yet. Rendering "#4" with no subject tells the user
 * nothing, so these are held back until the real subject arrives.
 */
const PLACEHOLDER_SUBJECT = /^#\d+$/;

export const SessionTaskPanel = React.memo<{ session: Session }>(({ session }) => {
    const [expanded, setExpanded] = React.useState(false);

    const todos = React.useMemo(
        () => (session.todos ?? []).filter((todo) => !PLACEHOLDER_SUBJECT.test(todo.content.trim())),
        [session.todos],
    );

    const { done, active } = React.useMemo(() => ({
        done: todos.filter((todo) => todo.status === 'completed').length,
        active: todos.filter((todo) => todo.status === 'in_progress'),
    }), [todos]);

    if (todos.length === 0) {
        return null;
    }

    // Collapsed shows what is being worked on. With nothing active, fall back to
    // the next pending item so the panel always says what comes next. Cap it so
    // a session with many parallel tasks cannot swallow the chat.
    const COLLAPSED_MAX = 3;
    const upNext = todos.filter((todo) => todo.status === 'pending').slice(0, 1);
    const collapsedSource = active.length > 0 ? active : upNext;
    const visible = expanded ? todos : collapsedSource.slice(0, COLLAPSED_MAX);
    const hiddenCount = expanded ? 0 : collapsedSource.length - visible.length;

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
                                <Text style={[styles.rowIcon, isInProgress && styles.rowIconActive]}>
                                    {isCompleted ? '☑' : isInProgress ? '●' : '☐'}
                                </Text>
                                <Text
                                    style={[
                                        styles.rowText,
                                        isCompleted && styles.rowTextCompleted,
                                        isInProgress && styles.rowTextActive,
                                    ]}
                                    numberOfLines={2}
                                >
                                    {todo.content}
                                </Text>
                            </View>
                        );
                    })}
                    {hiddenCount > 0 && (
                        <Text style={styles.more}>{`+${hiddenCount} more`}</Text>
                    )}
                </View>
            )}
        </Pressable>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        backgroundColor: theme.colors.surfaceHigh,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
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
    rowIconActive: {
        // Blue reads as "active" and is distinct from the green of done and the
        // grey of pending; a plain white glyph did not signal anything.
        color: theme.colors.radio.active,
    },
    rowText: {
        flex: 1,
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    rowTextActive: {
        color: theme.colors.text,
        fontWeight: '600',
    },
    more: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginLeft: 19,
    },
    rowTextCompleted: {
        color: theme.colors.success,
        textDecorationLine: 'line-through',
    },
}));
