import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import React from 'react';
import { Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { workflowCleanApproval, workflowObjections, workflowTaskInStep, workflowVoteGroups, type WorkflowRun, type WorkflowTask } from '@ahmadposten/talos-wire';
import { workflowRunSteps, workflowParticipantState } from './runPresentation';
import { WorkflowButton as Button, WorkflowStatusChip, useWorkflowStyles } from './ui';
import { WorkflowTaskDetail } from './WorkflowTaskDetail';
import type { TeamSelection } from './WorkflowTeam';

function decisionLabel(task?: WorkflowTask) {
    if (!task || task.status === 'running') return 'Pending';
    if (task.status === 'interrupted') return 'Interrupted';
    if (workflowCleanApproval(task)) return 'Approved';
    return task.result?.decision === 'information' ? 'Needs information' : task.result?.decision === 'replan' ? 'Replan requested' : 'Changes requested';
}

export function WorkflowDiscussion({ run, selection, onSelect, onSession, planRequest, onLatest }: {
    run: WorkflowRun; selection: TeamSelection; onSelect: (value: TeamSelection) => void; onSession: (id: string) => void; planRequest: number; onLatest: () => void;
}) {
    const s = useWorkflowStyles(), window = useWindowDimensions(), focused = useIsFocused(), insets = useSafeAreaInsets();
    const [pane, setPane] = React.useState('Discussion');
    const [round, setRound] = React.useState('all'), [unresolved, setUnresolved] = React.useState(false);
    const [detailStack, setDetailStack] = React.useState<string[]>([]);
    const activityCount = run.tasks.reduce((count, task) => count + 1 + (task.status !== 'running' ? 1 : 0), 0);
    const [seen, setSeen] = React.useState(activityCount);
    const steps = workflowRunSteps(run).steps;
    const step = steps.find(item => item.id === selection.stepId) ?? steps[0];
    const tasks = run.tasks.filter(task => workflowTaskInStep(task, step.id, run));
    const members = [...new Map([...step.agents.map(slot => [slot.agent.id, slot.agent.name] as const), ...tasks.map(task => [task.agentId, task.agentName] as const)]).entries()];
    const rounds = [...new Set(tasks.map(task => `${task.attempt ?? 0}:${task.round}`))];
    const filtered = tasks.filter(task => (!selection.agentId || task.agentId === selection.agentId) && (round === 'all' || `${task.attempt ?? 0}:${task.round}` === round));
    const objections = workflowObjections(tasks);
    const selectedTask = run.tasks.find(task => task.id === detailStack.at(-1));
    const inspect = (id: string) => setDetailStack(stack => stack.at(-1) === id ? stack : [...stack, id]);
    const groups = workflowVoteGroups(tasks);
    const latestPlan = tasks.filter(task => task.stage === 'consolidate' && task.status === 'done').at(-1);
    React.useEffect(() => { setRound('all'); setUnresolved(false); setDetailStack([]); }, [selection.stepId]);
    React.useEffect(() => { setDetailStack([]); }, [selection.agentId]);
    React.useEffect(() => { if (planRequest) setPane('Plan'); }, [planRequest]);
    return <View style={{ gap: 18 }}>
        <View style={{ gap: 6 }}><Text accessibilityRole="header" style={{ ...s.text, fontSize: 21, fontWeight: '600' }}>{selection.agentId ? members.find(([id]) => id === selection.agentId)?.[1] : step.name} · {selection.agentId ? 'history' : 'team'}</Text>
            <Text style={s.muted}>{objections.filter(item => item.status !== 'verified').length} unresolved objections · {tasks.filter(task => task.status === 'done').length} contributions</Text></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {[[null, 'Everyone'], ...members].map(([id, name]) => <Pressable key={id ?? 'all'} accessibilityRole="button" accessibilityLabel={`Show ${name} contributions`} accessibilityState={{ selected: selection.agentId === id }} onPress={() => onSelect({ stepId: step.id, agentId: id })}
                style={{ padding: 11, minHeight: 44, borderRadius: 12, backgroundColor: selection.agentId === id ? s.colors.accentSoft : s.colors.surface }}><Text style={{ ...s.muted, color: selection.agentId === id ? s.colors.accent : s.colors.text }}>{name}</Text></Pressable>)}
        </ScrollView>
        <View accessibilityRole="tablist" style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: s.colors.divider }}>
            {['Discussion', 'Plan', 'Decisions'].map(name => <Pressable key={name} accessibilityRole="tab" accessibilityLabel={name} aria-selected={pane === name} accessibilityState={{ selected: pane === name }} onPress={() => setPane(name)} style={{ flex: 1, paddingVertical: 12, borderBottomWidth: 2, borderColor: pane === name ? s.colors.accent : 'transparent', alignItems: 'center' }}><Text style={{ ...s.muted, fontWeight: pane === name ? '600' : '400' }}>{name}</Text></Pressable>)}
        </View>
        {!run.historyVersion && <Text style={s.muted}>This older run has limited history metadata. Open original task evidence for the complete recorded output; unavailable links and resolutions are not inferred.</Text>}
        {pane === 'Discussion' && <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {['all', ...rounds].map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: round === value }} onPress={() => setRound(value)} style={{ minHeight: 44, padding: 10, backgroundColor: round === value ? s.colors.surfaceHigh : 'transparent', borderRadius: 10 }}><Text style={s.muted}>{value === 'all' ? 'All rounds' : `Round ${value.split(':')[1]}${Number(value.split(':')[0]) ? ` · attempt ${value.split(':')[0]}` : ''}`}</Text></Pressable>)}
            </ScrollView>
            <Button label={unresolved ? 'Show all discussion' : 'Show unresolved objections'} compact variant="ghost" onPress={() => setUnresolved(!unresolved)} />
            {activityCount > seen && <Button label={`${activityCount - seen} new updates`} onPress={() => { setSeen(activityCount); onLatest(); }} />}
            {unresolved ? objections.filter(item => item.status !== 'verified' && filtered.some(task => task.id === item.task.id)).map(item => <View key={item.id} style={{ ...s.card, padding: 16 }}>
                <Text style={{ ...s.text, fontWeight: '600' }}>{item.finding.title}</Text><Text style={s.muted}>{item.task.agentName} · {item.task.version.replace('plan:', 'v')} · {item.status}</Text><Button label="Read objection" onPress={() => inspect(item.task.id)} />
            </View>) : filtered.map(task => <View key={task.id} style={{ gap: 10, paddingVertical: 12, paddingLeft: 14, borderLeftWidth: 2, borderColor: task.result?.findings.some(f => f.blocking) ? s.colors.warning : s.colors.divider }}>
                {!!task.inputs?.length && <Pressable accessibilityRole="button" accessibilityLabel={`Inspect handoff to ${task.agentName} round ${task.round}`} onPress={() => inspect(task.id)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ ...s.muted, fontSize: 12 }}>Coordinator shared {task.inputs.length} earlier {task.inputs.length === 1 ? 'output' : 'outputs'} with {task.agentName} ↗</Text></Pressable>}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}><Text style={{ ...s.text, fontWeight: '600', flex: 1 }}>{task.agentName}</Text><WorkflowStatusChip label={['plan_vote', 'review'].includes(task.stage) ? decisionLabel(task) : task.status === 'done' ? 'Finished' : workflowParticipantState(run, task)} tone={workflowCleanApproval(task) && ['plan_vote', 'review'].includes(task.stage) ? 'success' : task.result?.findings.some(f => f.blocking) ? 'warning' : 'neutral'} /></View>
                <Text style={{ ...s.muted, fontSize: 12 }}>{task.stage === 'propose' ? 'Independent proposal' : task.stage === 'consolidate' ? 'Plan revision' : task.stage === 'plan_vote' ? 'Plan assessment' : task.stage} · {task.version.replace('plan:', 'v')} · Round {task.round} · {new Date(task.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                <Text style={s.text}>{task.result?.summary || (task.status === 'running' ? 'Working on this contribution…' : 'Open the recorded evidence for details.')}</Text>
                {task.result?.findings.filter(f => f.blocking).map((finding, index) => <Text key={index} style={{ ...s.muted, color: s.colors.warning }}>Objection · {finding.title}</Text>)}
                <Button label="Read contribution" accessibilityLabel={`Read ${task.agentName} ${task.stage} round ${task.round}`} variant="ghost" compact onPress={() => inspect(task.id)} />
            </View>)}
            {!filtered.length && <Text style={s.muted}>No contributions yet for this selection. Every participant stays available as work progresses.</Text>}
            {unresolved && !objections.some(item => item.status !== 'verified' && filtered.some(task => task.id === item.task.id)) && <Text style={s.muted}>No recorded unresolved objections for this selection.</Text>}
        </>}
        {pane === 'Plan' && <>
            <Text style={s.muted}>Every recorded plan revision stays available with its original transcript.</Text>
            {tasks.filter(task => task.stage === 'consolidate').map(task => <View key={task.id} style={{ ...s.card, padding: 16 }}><Text style={{ ...s.text, fontWeight: '600' }}>Plan · {task.version.replace('plan:', 'v')}{task.id === latestPlan?.id ? ' · Latest' : ''}</Text><Text style={s.muted}>{task.agentName} · Round {task.round}</Text><Text style={s.text}>{task.result?.summary || 'Consolidating proposals…'}</Text><Button label={`Read plan ${task.version.replace('plan:', 'v')}`} onPress={() => inspect(task.id)} /></View>)}
            {!tasks.some(task => task.stage === 'consolidate') && <Text style={s.muted}>No plan has been produced in this step. Independent proposals appear in Discussion.</Text>}
        </>}
        {pane === 'Decisions' && <>
            <Text style={s.muted}>Approvals apply only to the version shown. A new revision requires fresh votes from everyone.</Text>
            {groups.map(group => <View key={group.key} style={{ ...s.card, padding: 16 }}>
                <Text style={{ ...s.text, fontWeight: '600' }}>{group.version.replace('plan:', 'Plan v')} · Round {group.round}{group.attempt ? ` · Attempt ${group.attempt}` : ''}</Text>
                {!group.participants && <Text style={s.muted}>The original team roster was not recorded. Showing available votes.</Text>}
                {(group.participants ? group.participants.map(agent => [agent.id, agent.name] as const) : members.filter(([id]) => group.tasks.some(task => task.agentId === id))).map(([id, name]) => {
                    const vote = group.tasks.find(task => task.agentId === id);
                    return <Pressable key={id} accessibilityRole="button" accessibilityLabel={`${name}: ${decisionLabel(vote)} on ${group.version}`} disabled={!vote} onPress={() => vote && inspect(vote.id)} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}><Text style={{ ...s.text, flex: 1 }}>{name}</Text><WorkflowStatusChip label={decisionLabel(vote)} tone={workflowCleanApproval(vote) ? 'success' : vote?.result ? 'warning' : 'neutral'} /></Pressable>;
                })}
            </View>)}
            {!groups.length && <Text style={s.muted}>No votes have been recorded yet.</Text>}
            <Text accessibilityRole="header" style={{ ...s.text, fontWeight: '600', fontSize: 18 }}>Objections and resolutions</Text>
            {objections.map(item => <View key={item.id} style={{ ...s.card, padding: 16 }}>
                <Text style={{ ...s.text, fontWeight: '600' }}>{item.finding.title}</Text><Text style={s.muted}>Raised by {item.task.agentName} · {item.task.version.replace('plan:', 'v')}</Text>
                <WorkflowStatusChip label={item.status === 'verified' ? 'Verified by original assessor' : item.status === 'addressed' ? 'Addressed · awaiting verification' : 'Open'} tone={item.status === 'verified' ? 'success' : 'warning'} />
                <Button label="Read original objection" variant="ghost" onPress={() => inspect(item.task.id)} />
                {item.responses.map((response, index) => <View key={index} style={{ gap: 6, paddingLeft: 12, borderLeftWidth: 1, borderColor: s.colors.divider }}><Text style={s.muted}>{response.task.agentName} · {response.status} · {response.task.version.replace('plan:', 'v')}</Text><Text style={s.text}>{response.evidence}</Text><Button label="Read response and evidence" variant="ghost" onPress={() => inspect(response.task.id)} /></View>)}
            </View>)}
        </>}
        <Modal visible={!!selectedTask && focused} transparent animationType="slide" onRequestClose={() => setDetailStack([])}>
            <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
                <View accessibilityViewIsModal style={{ width: window.width >= 1000 ? 540 : '100%', backgroundColor: s.colors.groupped.background, paddingTop: Math.max(16, insets.top), paddingBottom: 24 }}>
                    <View style={{ paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between' }}><Button label={detailStack.length > 1 ? 'Back to previous evidence' : 'Back to discussion'} variant="ghost" onPress={() => setDetailStack(stack => stack.slice(0, -1))} /><Button label="Close evidence" variant="ghost" onPress={() => setDetailStack([])} /></View>
                    <ScrollView horizontal style={{ flexGrow: 0, flexShrink: 0, height: 52 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 6, alignItems: 'center' }}>{members.map(([id, name]) => <Button key={id} label={name} accessibilityLabel={`Switch evidence to ${name}`} compact variant="ghost" onPress={() => { const candidates = tasks.filter(t => t.agentId === id); const next = candidates.filter(t => t.stage === selectedTask?.stage && t.round === selectedTask.round && t.attempt === selectedTask.attempt).at(-1) ?? candidates.filter(t => t.round === selectedTask?.round && t.attempt === selectedTask.attempt).at(-1) ?? candidates.at(-1); if (next) setDetailStack([next.id]); }} />)}</ScrollView>
                    <ScrollView key={selectedTask?.id} contentContainerStyle={{ padding: 20, gap: 16 }}>{selectedTask && <WorkflowTaskDetail run={run} task={selectedTask} onOpenTask={inspect} onSession={onSession} />}</ScrollView>
                </View>
            </View>
        </Modal>
    </View>;
}
