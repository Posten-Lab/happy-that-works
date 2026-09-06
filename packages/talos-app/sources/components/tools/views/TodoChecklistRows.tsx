import * as React from 'react';
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

export interface TodoRowItem {
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    id?: string;
}

/**
 * The todo checklist rows, on their own.
 *
 * Deliberately dependency-free (react-native + unistyles only): the pinned
 * session panel renders these, and importing them via TodoView pulled in the
 * whole tool-view registry — a require cycle that Metro's production bundle
 * resolved to an empty render on device while dev web looked fine. Keeping the
 * rows here breaks that cycle for good.
 *
 * Colors come from the theme instead of the old hardcoded light-mode values
 * (black text on the dark theme was invisible).
 */
export const TodoChecklistRows = React.memo<{ items: TodoRowItem[] }>(({ items }) => {
    if (items.length === 0) {
        return null;
    }
    return (
        <View style={styles.container}>
            {items.map((todo, index) => {
                const isCompleted = todo.status === 'completed';
                const isInProgress = todo.status === 'in_progress';
                return (
                    <View key={todo.id || `todo-${index}`} style={styles.row}>
                        <Text style={[
                            styles.icon,
                            isCompleted && styles.iconCompleted,
                            isInProgress && styles.iconActive,
                        ]}>
                            {isCompleted ? '☑' : isInProgress ? '●' : '☐'}
                        </Text>
                        <Text
                            style={[
                                styles.text,
                                isCompleted && styles.textCompleted,
                                isInProgress && styles.textActive,
                            ]}
                            numberOfLines={2}
                        >
                            {todo.content}
                        </Text>
                    </View>
                );
            })}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        gap: 4,
        paddingHorizontal: 14,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 6,
    },
    icon: {
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    iconActive: {
        color: theme.colors.radio.active,
    },
    iconCompleted: {
        color: theme.colors.success,
    },
    text: {
        flex: 1,
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    textActive: {
        color: theme.colors.text,
        fontWeight: '600',
    },
    textCompleted: {
        color: theme.colors.success,
        textDecorationLine: 'line-through',
    },
}));
