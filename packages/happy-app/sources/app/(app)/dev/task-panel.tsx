import * as React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { SessionTaskPanel } from '@/-session/SessionTaskPanel';
import { foldTaskTool, stripFoldMeta, FoldedTask } from '@/sync/reducer/taskTools';
import { Session } from '@/sync/storageTypes';

/**
 * Dev preview for the session task panel.
 *
 * Feeds the real fold logic the real payload shapes from session ba91de6b, in
 * the order the client actually receives them (newest page first, older pages
 * back-filled), so what renders here is what renders in a session.
 */

const CREATES: Array<[string, string]> = [
    ['1', 'Phase 0 — Plan + design spec + approval'],
    ['2', 'Phase 1 — Parallel execution (backend + mobile worktrees)'],
    ['3', 'Phase 2 — Screenshots (isolated sim + backend)'],
    ['4', 'Phase 3 — UI review panel (Codex, 3 lenses, cap 5)'],
    ['5', 'Phase 4 — Correctness review (Codex alignment + adversarial, cap 5)'],
    ['6', 'Phase 5 — All-suites-green + open both PRs'],
    ['7', 'Phase 6 — Retrospection (blocking, needs explicit approval)'],
    ['8', 'Run correctness iteration 6 under authorised --force-beyond-cap'],
    ['9', 'Relaunch UI review iteration 3 (killed by session restart)'],
    ['10', 'Retract the false signed-out capture claim in correctness-4-dispositions.md'],
    ['11', 'Re-capture all brief-bearing states against the current build'],
];

const UPDATES: Array<[string, string]> = [
    ['1', 'completed'], ['2', 'completed'], ['3', 'completed'],
    ['4', 'in_progress'], ['5', 'in_progress'],
    ['8', 'in_progress'], ['9', 'in_progress'], ['11', 'in_progress'],
    ['10', 'completed'],
];

function buildTodos(order: 'chronological' | 'client'): FoldedTask[] {
    // (call, at) pairs in true chronological order
    const calls: Array<{ tool: string; input: any; result: any; at: number }> = [];
    let at = 1000;
    for (const [id, subject] of CREATES) {
        calls.push({ tool: 'TaskCreate', input: {}, result: { task: { id, subject } }, at: at++ });
    }
    for (const [taskId, to] of UPDATES) {
        calls.push({ tool: 'TaskUpdate', input: {}, result: { taskId, statusChange: { from: 'pending', to } }, at: at++ });
    }
    // The client fetches the newest page first, then back-fills older pages.
    const pages: typeof calls[] = [];
    const PAGE = 5;
    for (let start = calls.length; start > 0; start -= PAGE) {
        pages.push(calls.slice(Math.max(0, start - PAGE), start));
    }
    const ordered = order === 'chronological' ? [calls] : pages;

    let list: FoldedTask[] = [];
    for (const page of ordered) {
        for (const c of page) {
            const next = foldTaskTool(list, c.tool, c.input, c.result, c.at);
            if (next) list = next;
        }
    }
    return list;
}

function fakeSession(todos: FoldedTask[]): Session {
    return { id: 'preview', todos: stripFoldMeta(todos) } as unknown as Session;
}

export default React.memo(function TaskPanelPreview() {
    const chronological = React.useMemo(() => buildTodos('chronological'), []);
    const clientOrder = React.useMemo(() => buildTodos('client'), []);
    const placeholdersOnly = React.useMemo(() => {
        // only updates have arrived; no create has been back-filled yet
        let list: FoldedTask[] = [];
        for (const [taskId, to] of UPDATES) {
            const next = foldTaskTool(list, 'TaskUpdate', {}, { taskId, statusChange: { from: 'pending', to } }, 9000);
            if (next) list = next;
        }
        return list;
    }, []);

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Text style={styles.caption}>client order (newest page first) — collapsed then expanded</Text>
            <View style={styles.frame}><SessionTaskPanel session={fakeSession(clientOrder)} /></View>

            <Text style={styles.caption}>chronological — must match the above</Text>
            <View style={styles.frame}><SessionTaskPanel session={fakeSession(chronological)} /></View>

            <Text style={styles.caption}>placeholders only (creates not back-filled) — must render nothing</Text>
            <View style={styles.frame}><SessionTaskPanel session={fakeSession(placeholdersOnly)} /></View>

            <Text style={styles.caption}>empty session — must render nothing</Text>
            <View style={styles.frame}><SessionTaskPanel session={fakeSession([])} /></View>

            <Text style={styles.caption}>all completed — header only, no rows</Text>
            <View style={styles.frame}><SessionTaskPanel session={fakeSession(
                CREATES.map(([id, subject]) => ({ id, content: subject, status: 'completed' as const }))
            )} /></View>

            <Text style={styles.caption}>nothing started — should show the next pending item</Text>
            <View style={styles.frame}><SessionTaskPanel session={fakeSession(
                CREATES.slice(0, 4).map(([id, subject]) => ({ id, content: subject, status: 'pending' as const }))
            )} /></View>

            <Text style={styles.caption}>single very long title — must wrap, not overflow</Text>
            <View style={styles.frame}><SessionTaskPanel session={fakeSession([
                { id: '1', content: 'Re-capture every brief-bearing state against the current build including the signed-out variant and the empty-portfolio case', status: 'in_progress' },
            ])} /></View>

            <Text style={styles.caption}>{`raw: client=${clientOrder.length} chronological=${chronological.length} placeholders=${placeholdersOnly.length}`}</Text>
        </ScrollView>
    );
});

const styles = StyleSheet.create((theme) => ({
    screen: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    content: {
        padding: 12,
        gap: 8,
    },
    caption: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        marginTop: 12,
    },
    frame: {
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
}));
