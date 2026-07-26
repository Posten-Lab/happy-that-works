import * as React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { SessionTaskPanel } from '@/-session/SessionTaskPanel';
import { Session } from '@/sync/storageTypes';
import { TodoItem } from '@/sync/storageTypes';

/**
 * Dev preview for the pinned todo panel.
 *
 * The list now arrives pre-folded from happy-cli as a whole-list TodoWrite, for
 * both Claude and Codex, so these cases are just shapes of that list.
 */
const fakeSession = (todos: TodoItem[]): Session => ({ id: 'preview', todos }) as unknown as Session;

const CLAUDE: TodoItem[] = [
    { id: '1', content: 'Phase 0 — Plan + design spec + approval', status: 'completed' },
    { id: '2', content: 'Phase 1 — Parallel execution (backend + mobile worktrees)', status: 'completed' },
    { id: '3', content: 'Phase 2 — Screenshots (isolated sim + backend)', status: 'completed' },
    { id: '4', content: 'Phase 3 — UI review panel (Codex, 3 lenses, cap 5)', status: 'in_progress' },
    { id: '5', content: 'Phase 4 — Correctness review (Codex alignment + adversarial)', status: 'in_progress' },
    { id: '6', content: 'Phase 5 — All-suites-green + open both PRs [blocked by #4, #5]', status: 'pending' },
];

const CODEX: TodoItem[] = [
    { id: '1', content: 'Review the folder contents and identify clutter', status: 'completed' },
    { id: '2', content: 'Group related files into a clear structure', status: 'completed' },
    { id: '3', content: 'Remove or archive obsolete items', status: 'in_progress' },
    { id: '4', content: 'Verify the folder is tidy and consistently organized', status: 'pending' },
];

export default React.memo(function TaskPanelPreview() {
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Text style={styles.caption}>claude — folded by happy-cli</Text>
            <View style={styles.frame}><SessionTaskPanel session={fakeSession(CLAUDE)} /></View>

            <Text style={styles.caption}>codex — same panel, same shape</Text>
            <View style={styles.frame}><SessionTaskPanel session={fakeSession(CODEX)} /></View>

            <Text style={styles.caption}>all completed</Text>
            <View style={styles.frame}><SessionTaskPanel session={fakeSession(
                CODEX.map((t) => ({ ...t, status: 'completed' as const }))
            )} /></View>

            <Text style={styles.caption}>nothing started</Text>
            <View style={styles.frame}><SessionTaskPanel session={fakeSession(
                CODEX.map((t) => ({ ...t, status: 'pending' as const }))
            )} /></View>

            <Text style={styles.caption}>empty — must render nothing</Text>
            <View style={styles.frame}><SessionTaskPanel session={fakeSession([])} /></View>

            <Text style={styles.caption}>very long title — must wrap</Text>
            <View style={styles.frame}><SessionTaskPanel session={fakeSession([
                { id: '1', content: 'Re-capture every brief-bearing state against the current build including the signed-out variant and the empty-portfolio case', status: 'in_progress' },
            ])} /></View>
        </ScrollView>
    );
});

const styles = StyleSheet.create((theme) => ({
    screen: { flex: 1, backgroundColor: theme.colors.groupped.background },
    content: { padding: 12, gap: 8 },
    caption: { fontSize: 11, color: theme.colors.textSecondary, marginTop: 12 },
    frame: { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface },
}));
