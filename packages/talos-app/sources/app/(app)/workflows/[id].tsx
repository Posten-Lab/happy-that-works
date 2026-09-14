import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { workflowStageLabel, workflowSlots, workflowRecoverableExecutor, type WorkflowRun, type WorkflowTask } from '@ahmadposten/talos-wire';
import { loadWorkflowRun, workflowRPC } from '@/workflows/api';
import { WorkflowButton as Button, WorkflowInput as Input, WorkflowAvatar, WorkflowStatusChip, WorkflowSectionHeader, useWorkflowStyles } from '@/workflows/ui';
import { useSetting } from '@/sync/storage';
import { Modal } from '@/modal';
import { Typography } from '@/constants/Typography';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { WorkflowScaffold, WorkflowNotice } from '@/workflows/WorkflowScaffold';
import { workflowErrorMessage, workflowRunMessage } from '@/workflows/errors';
import { workflowCurrentParticipants, workflowDefaultPane, workflowParticipantState, workflowRunSteps, type WorkflowPane } from '@/workflows/runPresentation';
import { t } from '@/text';
import { WorkflowModelRecovery } from '@/workflows/WorkflowModelRecovery';

const providers = { codex: 'Codex', claude: 'Claude', muse: 'Muse Code' };
const statusLabels = { running: 'Running', paused: 'Paused', needs_input: 'Needs you', complete: 'Complete', cancelled: 'Cancelled' };
const panes: WorkflowPane[] = ['Plan', 'Work', 'Review', 'Activity'];

export default function WorkflowRunScreen() {
    const params = useLocalSearchParams<{ id: string; machineId: string }>();
    const id = typeof params.id === 'string' ? params.id : '', machine = typeof params.machineId === 'string' ? params.machineId : '';
    const router = useRouter(), s = useWorkflowStyles(), window = useWindowDimensions();
    const legacyAgents = useSetting('agentLibrary'), providerAgents = useSetting('agentLibraryV2');
    const agents = [...legacyAgents, ...providerAgents];
    const [run, setRun] = React.useState<WorkflowRun | null>(null), [error, setError] = React.useState(''), [note, setNote] = React.useState('');
    const [busy, setBusy] = React.useState(false), [chosenPane, setChosenPane] = React.useState<WorkflowPane | null>(null);
    const [replacement, setReplacement] = React.useState<string | null>(null), [controls, setControls] = React.useState(false);
    const [detail, setDetail] = React.useState<WorkflowTask | null>(null), [detailLoading, setDetailLoading] = React.useState('');
    const [connectionError, setConnectionError] = React.useState(''), [diagnostics, setDiagnostics] = React.useState(false);
    const [expanded, setExpanded] = React.useState<string | null>(null), [promptExpanded, setPromptExpanded] = React.useState(false);
    const [workspaceExpanded, setWorkspaceExpanded] = React.useState(false), [fullPrompt, setFullPrompt] = React.useState(false);
    const [requestChanges, setRequestChanges] = React.useState(false);
    const [checkExpanded, setCheckExpanded] = React.useState<number | null>(null), [activityLimit, setActivityLimit] = React.useState(6);
    const [contentWidth, setContentWidth] = React.useState(0);
    const runTop = React.useRef(0), paneTop = React.useRef(0);
    const wide = contentWidth >= 820 || window.width >= 1280;
    const acting = React.useRef(false), detailSequence = React.useRef(0), scroll = React.useRef<ScrollView>(null);
    const routeKey = `${machine}:${id}`, route = React.useRef(routeKey); route.current = routeKey;
    React.useEffect(() => {
        let live = true, loading = false;
        setRun(null); setChosenPane(null); setError(''); setConnectionError(''); setNote(''); setExpanded(null); setDetail(null); setReplacement(null); setControls(false); setPromptExpanded(false); setActivityLimit(6); setDiagnostics(false); setRequestChanges(false);
        const refresh = async () => {
            if (loading) return; loading = true;
            try { const value = await loadWorkflowRun(machine, id); if (live) { setRun(current => current?.id === value.id && current.revision > value.revision ? current : value); setConnectionError(''); } }
            catch { if (live) setConnectionError('Showing the last update. Reconnect the machine that started this run to continue.'); }
            finally { loading = false; }
        };
        void refresh(); const timer = setInterval(refresh, 4000); return () => { live = false; clearInterval(timer); };
    }, [machine, id]);
    React.useEffect(() => { if (error) scroll.current?.scrollTo({ y: 0, animated: true }); }, [error]);
    const currentIndex = run ? workflowRunSteps(run).currentIndex : 0;
    const action = async (name: string, extra: object = {}) => {
        if (!run || acting.current) return;
        acting.current = true;
        const requestRoute = routeKey;
        try {
            if (name === 'cancel' && !(await Modal.confirm('Cancel this run?', t('workflowWorkspace.cancelMessage', { isolated: run.directory !== run.sourceDirectory })))) return;
            setBusy(true);
            await workflowRPC(machine, name === 'change_model' ? 'change-model-v1' : 'action', { id, expectedRevision: run.revision, action: name, note, ...extra });
            const value = await loadWorkflowRun(machine, id);
            if (route.current === requestRoute) { setRun(current => current?.id === value.id && current.revision > value.revision ? current : value); setNote(''); setReplacement(null); setError(''); }
        } catch (failure) { if (route.current === requestRoute) setError(workflowErrorMessage(failure, 'The action could not be completed. Check the latest run state and try again.')); }
        finally { acting.current = false; setBusy(false); }
    };
    const showDetails = async (task: WorkflowTask) => {
        if (expanded === task.id) { detailSequence.current++; setExpanded(null); setDetailLoading(''); return; }
        const sequence = ++detailSequence.current, requestRoute = routeKey;
        setExpanded(task.id); setDetail(null); setFullPrompt(false); setDetailLoading(task.id);
        try { const value = await workflowRPC<WorkflowTask>(machine, 'task', { id, taskId: task.id }); if (route.current === requestRoute && sequence === detailSequence.current) setDetail(value); }
        catch (failure) { if (route.current === requestRoute && sequence === detailSequence.current) setError(workflowErrorMessage(failure, 'Details could not be loaded. Check the machine connection and try again.')); }
        finally { if (sequence === detailSequence.current) setDetailLoading(''); }
    };
    const openSession = (sessionId: string) => router.push(`/session/${sessionId}` as any);
    const readPlan = () => {
        setChosenPane('Plan');
        requestAnimationFrame(() => scroll.current?.scrollTo({ y: Math.max(0, runTop.current + paneTop.current - 12), animated: true }));
    };
    const finished = run?.status === 'complete' || run?.status === 'cancelled';
    const slots = run ? [...new Map(workflowSlots(run.definition).map(slot => [slot.agent.id, slot])).values()] : [];
    const presentation = run ? workflowRunSteps(run) : null;
    const currentStep = run?.definition.steps?.[run.stepIndex ?? 0];
    const participants = run ? workflowCurrentParticipants(run) : [];
    const pane = chosenPane ?? (run ? workflowDefaultPane(run) : 'Plan');
    const currentPlanStep = run?.definition.steps?.slice(0, (run.stepIndex ?? 0) + 1).reverse().find(step => step.kind === 'plan');
    const votes = run?.tasks.filter(task => task.stage === 'plan_vote' && task.version === `plan:${run.planVersion}` && task.round === run.planningRound && (!currentPlanStep || task.stepId === currentPlanStep.id && (currentStep?.kind !== 'plan' || task.attempt === run.stepAttempt))) ?? [];
    const canApprove = !!run && run.stage === 'plan_vote' && (currentPlanStep?.agents ?? run.definition.planners).every(slot => { const vote = [...votes].reverse().find(task => task.agentId === slot.agent.id); return vote?.status === 'done' && vote.result?.decision === 'approve' && !vote.result.findings.some(finding => finding.blocking); });
    const latestReviewTask = run ? [...run.tasks].reverse().find(task => task.stage === 'review') : undefined;
    const reviewStep = currentStep?.kind === 'review' ? currentStep.id : latestReviewTask?.stepId;
    const latestReview = run?.tasks.filter(task => task.stage === 'review' && task.round === (currentStep?.kind === 'review' ? run.reviewRound : latestReviewTask?.round) && (!run.definition.steps || task.stepId === reviewStep && task.attempt === (currentStep?.kind === 'review' ? run.stepAttempt : latestReviewTask?.attempt))) ?? [];
    const executions = run?.tasks.filter(task => task.stage === 'execute').reverse() ?? [];
    const reason = run?.reason ? workflowRunMessage(run.reason, run.tasks) : '';
    const tone = run?.status === 'complete' ? 'success' : run?.status === 'needs_input' || run?.status === 'paused' ? 'warning' : run?.status === 'cancelled' ? 'neutral' : 'active';
    const isolatedWorkspace = !!run && run.directory !== run.sourceDirectory;
    const recoverableExecutor = run ? workflowRecoverableExecutor(run) : undefined;

    return <WorkflowScaffold scrollRef={scroll}>
        {connectionError !== '' && <WorkflowNotice title="Machine disconnected" message={connectionError} />}
        {error !== '' && <WorkflowNotice title="The run needs attention" message={error} action="Dismiss" onAction={() => setError('')} />}
        {!run ? <View style={{ gap: 16, paddingVertical: 40, alignItems: 'center' }}><ActivityIndicator color={s.colors.accent} /><Text style={s.muted}>Connecting to your workflow…</Text><Button label="Back to workflows" variant="ghost" compact onPress={() => router.push('/workflows' as any)} /></View> : <View onLayout={event => { setContentWidth(event.nativeEvent.layout.width); runTop.current = event.nativeEvent.layout.y; }} style={{ width: '100%', flexDirection: wide ? 'row' : 'column', alignItems: 'flex-start', gap: wide ? 36 : 24 }}>
            <View style={{ width: wide ? 320 : '100%', flexShrink: 0, gap: 16 }}>
            <View style={{ gap: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <Text style={{ ...s.muted, fontSize: 11, letterSpacing: 1.5 }}>WORKFLOW RUN</Text>
                    <WorkflowStatusChip label={statusLabels[run.status]} tone={tone} />
                </View>
                <Text accessibilityRole="header" style={{ ...s.text, ...Typography.header(), fontSize: 28, lineHeight: 34 }}>{run.definition.name}</Text>
                <View style={{ gap: 2 }}><Text selectable style={{ ...s.muted, fontSize: 15, lineHeight: 23 }} numberOfLines={promptExpanded ? undefined : 2}>{run.task}</Text>
                    {(run.task.length > 80 || run.task.includes('\n')) && <TextAction label={promptExpanded ? 'Show less' : 'Read full task'} onPress={() => setPromptExpanded(!promptExpanded)} />}</View>
            </View>

            <View accessibilityLabel="Workflow progress" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {presentation!.steps.map((step, index) => <Pressable key={step.id} accessibilityRole="button" accessibilityLabel={`Step ${index + 1}, ${step.name}, ${step.state}`} onPress={() => setChosenPane(step.kind === 'plan' ? 'Plan' : step.kind === 'execute' ? 'Work' : 'Review')} style={{ flexGrow: 1, flexBasis: 90, maxWidth: 180, gap: 6 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: step.state === 'current' ? 0 : 1, borderColor: s.colors.divider, backgroundColor: step.state === 'current' ? s.colors.accent : s.colors.surface }}>
                        {step.state === 'passed' ? <Ionicons name="checkmark" size={17} color={s.colors.success} /> : <Text style={{ ...s.muted, fontSize: 12, fontWeight: '600', color: step.state === 'current' ? s.colors.button.primary.tint : s.colors.textSecondary }}>{index + 1}</Text>}</View>{index < presentation!.steps.length - 1 && <View style={{ flex: 1, height: 1, backgroundColor: s.colors.divider }} />}</View>
                    <Text style={{ ...s.muted, fontSize: 12, lineHeight: 17, color: step.state === 'current' ? s.colors.text : s.colors.textSecondary, fontWeight: step.state === 'current' ? '600' : '400' }} numberOfLines={2}>{step.name}</Text>
                    <Text style={{ ...s.muted, fontSize: 11 }}>{step.state === 'passed' ? 'Complete' : step.state === 'waiting' ? 'Waiting' : step.state === 'stopped' ? 'Stopped' : run.status === 'needs_input' ? 'Needs attention' : run.status === 'paused' ? 'Paused' : 'In progress'}</Text>
                </Pressable>)}
            </View>

            <View style={{ backgroundColor: s.colors.surface, borderRadius: 20, borderWidth: 1, borderColor: s.colors.divider, padding: 18, gap: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Ionicons name={run.status === 'complete' ? 'checkmark-circle-outline' : run.status === 'needs_input' ? 'chatbubble-ellipses-outline' : run.stage === 'verify' ? 'shield-checkmark-outline' : 'pulse-outline'} size={21} color={run.status === 'complete' ? s.colors.success : s.colors.accent} />
                    <View style={{ flex: 1 }}><Text style={{ ...s.text, ...Typography.header(), fontWeight: '600' }}>{run.status === 'complete' ? 'Your team finished the job' : run.status === 'cancelled' ? 'Run stopped' : recoverableExecutor ? 'Build interrupted' : run.status === 'paused' ? 'Paused for you' : run.status === 'needs_input' ? 'Your input is needed' : workflowStageLabel[run.stage]}</Text>
                        {run.status === 'complete' && <Text style={s.muted}>Every required approval and check passed</Text>}
                        {run.status !== 'complete' && <Text style={{ ...s.muted, fontSize: 12 }}>Step {currentIndex + 1} of {presentation!.steps.length} · {presentation!.steps[currentIndex]?.name}</Text>}</View>
                    {run.status === 'running' && <Button label="Pause" accessibilityLabel="Pause run" variant="ghost" compact disabled={busy} onPress={() => void action('pause')} />}
                </View>
                {!!recoverableExecutor && <Text style={s.muted}>{recoverableExecutor.agent.modelLabel || recoverableExecutor.agent.model}</Text>}
                {participants.map(({ slot, task }) => <View key={slot.agent.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 12, borderTopWidth: 1, borderColor: s.colors.divider }}>
                    <WorkflowAvatar name={slot.agent.name} provider={slot.agent.provider} size={40} />
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}><Text style={{ ...s.text, ...Typography.header(), fontSize: 15 }} numberOfLines={1}>{slot.agent.name}</Text><Text style={{ ...s.muted, fontSize: 12 }} numberOfLines={1}>{providers[slot.agent.provider]} · {workflowParticipantState(run, task)}</Text></View>
                    {task?.sessionId ? <Button label="Open session" accessibilityLabel={`Open ${slot.agent.name} session`} variant="ghost" compact onPress={() => openSession(task.sessionId!)} /> : <Text style={{ ...s.muted, fontSize: 12 }}>Preparing</Text>}
                </View>)}
            </View>

            {run.status === 'needs_input' || run.status === 'paused' ? <View style={{ gap: 12 }}>
                {canApprove ? <>
                    <Text style={s.muted}>All planners agreed on plan v{run.planVersion}. Approve it to begin execution.</Text>
                    <TextAction label="Read agreed plan" onPress={readPlan} />
                    <Button primary label="Approve agreed plan" disabled={busy} onPress={() => void action('approve_plan')} />
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}><TextAction label={requestChanges ? 'Hide requested changes' : 'Request changes'} onPress={() => setRequestChanges(!requestChanges)} /><TextAction label={controls ? 'Hide run controls' : 'Run controls'} onPress={() => setControls(!controls)} /></View>
                    {requestChanges && <><Input label="Your guidance" placeholder="What should the planners change?" value={note} onChange={setNote} multiline /><Button label="Request revised plan" disabled={busy || !note.trim()} onPress={() => void action('revise_plan')} /></>}
                </> : <>
                    {!!reason && <Text style={s.text}>{reason}</Text>}
                    {run.reason !== reason && <TextAction label={diagnostics ? 'Hide technical details' : 'Show technical details'} onPress={() => setDiagnostics(!diagnostics)} />}
                    {diagnostics && <Text selectable style={s.muted}>{run.reason}</Text>}
                    {!!recoverableExecutor && <WorkflowModelRecovery key={`${routeKey}:${recoverableExecutor.agent.revision}`} machineId={machine} slot={recoverableExecutor} busy={busy} onResume={choice => void action('change_model', choice)} />}
                    <Input label="Your guidance" placeholder="Tell the team how to continue…" value={note} onChange={setNote} multiline hint="Inspect the agent’s session before resuming interrupted work." />
                    <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}><Button primary label={recoverableExecutor ? 'Retry current model' : 'Resume run'} disabled={busy || !recoverableExecutor && run.status === 'needs_input' && !note.trim()} onPress={() => void action('resume', recoverableExecutor && !note.trim() ? { note: 'Retry the interrupted Build step. Inspect partial edits and continue the approved plan.' } : {})} /><Button label="Run controls" variant="ghost" compact onPress={() => setControls(!controls)} /></View>
                    {run.status === 'needs_input' && !note.trim() && !recoverableExecutor && <Text style={{ ...s.muted, fontSize: 12 }}>Add guidance above to resume.</Text>}
                </>}
            </View> : !!reason && !finished ? <View style={{ gap: 6 }}><Text style={s.muted}>{reason}</Text>{run.reason !== reason && <><TextAction label={diagnostics ? 'Hide technical details' : 'Show technical details'} onPress={() => setDiagnostics(!diagnostics)} />{diagnostics && <Text selectable style={s.muted}>{run.reason}</Text>}</>}</View> : null}

            <View style={{ gap: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>{!finished && run.status === 'running' && <TextAction label={controls ? 'Hide run controls' : 'Run controls'} onPress={() => setControls(!controls)} />}<TextAction label="All workflows" onPress={() => router.push('/workflows' as any)} /></View>
            </View>
            {controls && !finished && <View style={{ padding: 16, gap: 14, borderRadius: 16, backgroundColor: s.colors.surfaceHigh }}>
                <WorkflowSectionHeader title="Run controls" />
                <Text style={s.muted}>{run.tasks.length} of {run.definition.maxTurns} agent turns · {run.definition.turnMinutes} minutes per turn{ '\n' }Planning round {run.planningRound}/{run.definition.planningRounds} · Review round {run.reviewRound}/{run.definition.reviewRounds}</Text>
                {run.status !== 'running' && <>
                    {canApprove && !requestChanges && <Input label="Your guidance" placeholder="Explain the change you want…" value={note} onChange={setNote} multiline />}
                    {!requestChanges && <Button disabled={busy || !note.trim()} label="Request revised plan" variant="secondary" onPress={() => void action('revise_plan')} />}
                    {(!currentStep || currentStep.kind === 'review') && <Button disabled={busy || !note.trim()} label="Verify and review current files" variant="secondary" onPress={() => void action('retry_review')} />}
                    <Text style={{ ...s.muted, fontSize: 12 }}>Add guidance above for changes. A revised plan needs new approvals; configured limits still apply.</Text>
                    <Button disabled={busy} label={replacement === null ? 'Replace a participant' : 'Close participant picker'} variant="ghost" onPress={() => setReplacement(replacement === null ? '' : null)} />
                    {replacement !== null && slots.map(slot => <View key={slot.agent.id} style={{ gap: 8 }}><Button label={`Replace ${slot.agent.name}`} compact onPress={() => setReplacement(slot.agent.id)} />{replacement === slot.agent.id && <>{agents.filter(agent => !slots.some(existing => existing.agent.id === agent.id)).map(agent => <Button key={agent.id} disabled={busy || !note.trim()} label={`Use ${agent.name} instead`} variant="ghost" onPress={() => void action('replace_agent', { agentId: slot.agent.id, replacement: agent })} />)}{!agents.some(agent => !slots.some(existing => existing.agent.id === agent.id)) && <Text style={s.muted}>Save another agent in your agent library before replacing this participant.</Text>}</>}</View>)}
                </>}
                <Button disabled={busy} label="Cancel run" variant="danger" compact onPress={() => void action('cancel')} />
            </View>}

            </View>
            <View onLayout={event => { paneTop.current = event.nativeEvent.layout.y; }} style={{ flex: wide ? 1 : undefined, width: wide ? undefined : '100%', minWidth: 0, gap: 24 }}>
            <View accessibilityRole="tablist" style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: s.colors.divider }}>
                {panes.map(label => <Pressable key={label} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: pane === label }} aria-selected={pane === label} onPress={() => setChosenPane(label)} style={({ pressed }) => ({ flex: 1, alignItems: 'center', paddingVertical: 13, borderBottomWidth: 2, borderColor: pane === label ? s.colors.accent : 'transparent', opacity: pressed ? 0.6 : 1 })}><Text style={{ ...s.text, fontSize: 14, fontWeight: pane === label ? '600' : '400', color: pane === label ? s.colors.text : s.colors.textSecondary }}>{label}</Text></Pressable>)}
            </View>
            <View accessibilityLabel={`${pane} panel`} style={{ gap: 24 }}>
                {pane === 'Plan' && <>
                    <View style={{ gap: 10 }}><WorkflowSectionHeader title={run.plan ? `Plan · v${run.planVersion}` : 'Planning together'} />{run.plan ? <MarkdownView markdown={run.plan} /> : <EmptyState icon="git-compare-outline" title="Your planners are getting started" message="Their proposals and agreed plan appear here. Open the active session above to follow their work." />}</View>
                    {votes.length > 0 && <View style={{ gap: 12 }}><WorkflowSectionHeader title="Planning consensus" />{votes.map(task => <View key={task.id} style={{ gap: 5, paddingVertical: 10, borderBottomWidth: 1, borderColor: s.colors.divider }}><View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}><Text style={{ ...s.text, ...Typography.header(), fontWeight: '600' }}>{task.agentName}</Text><WorkflowStatusChip label={task.result?.decision === 'approve' ? 'Approved' : workflowParticipantState(run, task)} tone={task.result?.decision === 'approve' ? 'success' : 'neutral'} /></View>{!!task.result?.summary && <Text style={s.muted}>{task.result.summary}</Text>}</View>)}</View>}
                    <View style={{ gap: 8 }}><WorkflowSectionHeader title="What success looks like" /><Text selectable style={s.muted}>{run.definition.criteria}</Text></View>
                </>}
                {pane === 'Work' && <>
                    <View style={{ gap: 12 }}><WorkflowSectionHeader title={run.status === 'complete' ? 'Delivered work' : 'Execution'} />{executions.length ? executions.map((task, index) => <View key={task.id} style={{ gap: 10, paddingBottom: 18, borderBottomWidth: 1, borderColor: s.colors.divider }}><View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}><Text style={{ ...s.text, ...Typography.header(), fontWeight: '600', flex: 1 }}>{run.definition.steps?.find(step => step.id === task.stepId)?.name ?? `Execution round ${task.round}`}</Text>{task.sessionId && <Button label="Open session" accessibilityLabel={`Open execution session round ${task.round}`} variant="ghost" compact onPress={() => openSession(task.sessionId!)} />}</View><View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}><Text style={{ ...s.muted, fontSize: 12, flex: 1 }}>{index === 0 ? 'Latest execution' : 'Earlier execution'} · {task.agentName}</Text><WorkflowStatusChip label={task.status === 'interrupted' ? 'Interrupted' : task.status === 'done' ? 'Finished' : workflowParticipantState(run, task)} tone={task.status === 'interrupted' ? 'warning' : 'neutral'} /></View><Text style={s.text}>{task.result?.summary ?? (task.status === 'running' ? 'Your executor is working on this step.' : workflowParticipantState(run, task))}</Text>{!!task.result?.document && <MarkdownView markdown={task.result.document} />}</View>) : <EmptyState icon="hammer-outline" title="Execution is up next" message="Once the planning step passes, the executor’s work and results appear here." />}</View>
                    <Checks run={run} expanded={checkExpanded} onExpand={index => setCheckExpanded(checkExpanded === index ? null : index)} />
                    <View style={{ gap: 10 }}><WorkflowSectionHeader title={t('workflowWorkspace.title')} action={workspaceExpanded ? t('workflowWorkspace.hideDetails') : t('workflowWorkspace.showDetails')} onAction={() => setWorkspaceExpanded(!workspaceExpanded)} /><Text selectable style={s.muted}>{run.sourceDirectory}</Text><Text style={{ ...s.muted, fontSize: 12 }}>{isolatedWorkspace ? t('workflowWorkspace.isolatedMessage') : t('workflowWorkspace.directMessage')}</Text>{workspaceExpanded && <View style={{ backgroundColor: s.colors.surfaceHigh, borderRadius: 12, padding: 14, gap: 8 }}><Text style={{ ...s.text, ...Typography.header(), fontWeight: '600', fontSize: 13 }}>{isolatedWorkspace ? t('workflowWorkspace.worktreeTitle') : t('workflowWorkspace.directoryTitle')}</Text><Text selectable style={s.muted}>{run.directory}</Text><Text selectable style={{ ...s.muted, fontSize: 12 }}>{run.branch ? t('workflowWorkspace.branch', { branch: run.branch }) : ''}{run.branch && run.baseCommit ? '\n' : ''}{run.baseCommit ? t('workflowWorkspace.baseCommit', { baseCommit: run.baseCommit }) : ''}{(run.branch || run.baseCommit) ? '\n' : ''}{t('workflowWorkspace.verifiedContents', { contents: run.artifactVersion || t('workflowWorkspace.notVerified') })}</Text></View>}</View>
                </>}
                {pane === 'Review' && <>
                    <Checks run={run} expanded={checkExpanded} onExpand={index => setCheckExpanded(checkExpanded === index ? null : index)} />
                    <View style={{ gap: 16 }}><WorkflowSectionHeader title="Independent review" />{latestReview.length === 0 ? <EmptyState icon="scan-outline" title={run.stage === 'verify' ? 'Checking the result first' : 'Review follows execution'} message="Every reviewer assesses the same version of the work. Decisions and concrete findings appear here." /> : latestReview.map(task => <View key={task.id} style={{ gap: 12, paddingBottom: 20, borderBottomWidth: 1, borderColor: s.colors.divider }}><View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}><Text style={{ ...s.text, ...Typography.header(), fontWeight: '600', flex: 1 }}>{task.agentName}</Text><WorkflowStatusChip label={task.result?.decision === 'approve' ? 'Approved' : workflowParticipantState(run, task)} tone={task.result?.decision === 'approve' ? 'success' : task.result ? 'warning' : 'neutral'} /></View>{!!task.result?.summary && <Text style={s.text}>{task.result.summary}</Text>}{task.result?.findings.map((finding, index) => <View key={index} style={{ borderLeftWidth: 2, borderColor: finding.blocking ? s.colors.warningCritical : s.colors.divider, paddingLeft: 14, gap: 6 }}><Text style={{ ...s.muted, fontSize: 11, letterSpacing: 0.7 }}>{finding.blocking ? 'NEEDS A FIX' : 'SUGGESTION'}</Text><Text style={{ ...s.text, ...Typography.header(), fontWeight: '600' }}>{finding.title}</Text><Text selectable style={s.muted}>{finding.evidence}</Text><Text selectable style={s.text}>{finding.correction}</Text></View>)}{task.sessionId && <TextAction label={`Open ${task.agentName} session`} onPress={() => openSession(task.sessionId!)} />}<Text selectable style={{ ...s.muted, fontSize: 11 }}>Reviewed version: {task.version}</Text></View>)}</View>
                </>}
                {pane === 'Activity' && <>
                    <View style={{ gap: 16 }}><WorkflowSectionHeader title="Agent activity" />{[...run.tasks].reverse().slice(0, activityLimit).map(task => <View key={task.id} style={{ paddingLeft: 16, borderLeftWidth: 1, borderColor: s.colors.divider, gap: 9 }}><View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}><View style={{ flex: 1 }}><Text style={{ ...s.text, ...Typography.header(), fontWeight: '600', fontSize: 15 }}>{task.agentName}</Text>{task.model && <Text style={{ ...s.muted, fontSize: 11 }}>{task.model}</Text>}<Text style={{ ...s.muted, fontSize: 12 }}>{run.definition.steps?.find(step => step.id === task.stepId)?.name ?? workflowStageLabel[task.stage]} · {new Date(task.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text></View><WorkflowStatusChip label={task.status === 'done' ? 'Done' : task.status === 'interrupted' ? 'Interrupted' : run.status === 'running' ? 'Working' : 'Stopped'} tone={task.status === 'interrupted' ? 'warning' : 'neutral'} /></View><Text style={s.muted}>{task.result?.summary ?? (task.error ? workflowErrorMessage(task.error, 'This agent was interrupted. Open its session to inspect the work before resuming.') : 'Working on the assigned task.')}</Text><View style={{ flexDirection: 'row', gap: 14 }}><TextAction label={expanded === task.id ? 'Hide details' : 'View details'} accessibilityLabel={`Details ${task.agentName} ${task.stage} round ${task.round}`} onPress={() => void showDetails(task)} />{task.sessionId && <TextAction label="Open session" accessibilityLabel={`Open ${task.agentName} ${task.stage} session`} onPress={() => openSession(task.sessionId!)} />}</View>{expanded === task.id && <View style={{ gap: 12, paddingVertical: 8 }}>{detailLoading === task.id ? <ActivityIndicator color={s.colors.accent} /> : detail?.id === task.id ? <>{!!detail.result?.document && <MarkdownView markdown={detail.result.document} />}{detail.result?.findings.map((finding, index) => <View key={index} style={{ gap: 4 }}><Text style={{ ...s.text, ...Typography.header(), fontWeight: '600' }}>{finding.title}</Text><Text selectable style={s.muted}>{finding.evidence}{'\n'}Required correction: {finding.correction}</Text></View>)}{!!task.error && <><Text style={{ ...s.muted, fontWeight: '600' }}>Technical details</Text><Text selectable style={s.muted}>{task.error}</Text></>}<TextAction label={fullPrompt ? 'Hide full prompt' : 'Show full prompt'} onPress={() => setFullPrompt(!fullPrompt)} />{fullPrompt && <Text selectable style={s.muted}>{detail.prompt}</Text>}</> : <Text style={s.muted}>Details are unavailable. Try again when the machine reconnects.</Text>}</View>}</View>)}{run.tasks.length > activityLimit && <TextAction label={`Show more activity (${run.tasks.length - activityLimit})`} onPress={() => setActivityLimit(activityLimit + 10)} />}{run.tasks.length === 0 && <Text style={s.muted}>The first agent’s activity will appear here.</Text>}</View>
                    <View style={{ gap: 12 }}><WorkflowSectionHeader title="Run history" />{[...run.events].reverse().map((event, index) => <View key={`${event.at}-${index}`} style={{ flexDirection: 'row', gap: 12 }}><Text style={{ ...s.muted, fontSize: 11, width: 54 }}>{new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text><Text style={{ ...s.muted, flex: 1 }}>{event.text === run.reason || run.tasks.some(task => task.error === event.text) ? workflowRunMessage(event.text, run.tasks) : event.text}</Text></View>)}</View>
                </>}
            </View>
            </View>
        </View>}
    </WorkflowScaffold>;
}

function TextAction({ label, accessibilityLabel, onPress }: { label: string; accessibilityLabel?: string; onPress: () => void }) {
    const s = useWorkflowStyles();
    return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} onPress={onPress} style={({ pressed }) => ({ minHeight: 44, paddingVertical: 8, alignSelf: 'flex-start', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}><Text style={{ ...s.muted, ...Typography.header(), fontSize: 13, color: s.colors.accent }}>{label}</Text></Pressable>;
}
function EmptyState({ icon, title, message }: { icon: 'git-compare-outline' | 'hammer-outline' | 'scan-outline'; title: string; message: string }) {
    const s = useWorkflowStyles();
    return <View style={{ gap: 10, paddingVertical: 12 }}><Ionicons name={icon} size={26} color={s.colors.textSecondary} /><Text style={{ ...s.text, ...Typography.header(), fontWeight: '600' }}>{title}</Text><Text style={s.muted}>{message}</Text></View>;
}
function Checks({ run, expanded, onExpand }: { run: WorkflowRun; expanded: number | null; onExpand: (index: number) => void }) {
    const s = useWorkflowStyles();
    return <View style={{ gap: 12 }}><WorkflowSectionHeader title="Completion checks" />{run.checks.length ? run.checks.map((check, index) => <View key={`${check.name}-${index}`} style={{ gap: 8 }}><Pressable accessibilityRole="button" accessibilityLabel={`${check.name}: ${check.exitCode === 0 ? 'Passed' : 'Failed'}. ${expanded === index ? 'Hide' : 'Show'} output`} accessibilityState={{ expanded: expanded === index }} onPress={() => onExpand(index)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 }}><Ionicons name={check.exitCode === 0 ? 'checkmark-circle-outline' : 'close-circle-outline'} size={21} color={check.exitCode === 0 ? s.colors.success : s.colors.warningCritical} /><View style={{ flex: 1 }}><Text style={{ ...s.text, fontSize: 14, fontWeight: '600' }}>{check.name}</Text><Text style={{ ...s.muted, fontSize: 12 }}>{check.exitCode === 0 ? 'Passed' : 'Failed'}{run.artifactVersion && check.version !== run.artifactVersion ? ' · Earlier revision' : ''}</Text></View><Ionicons name={expanded === index ? 'chevron-up' : 'chevron-down'} size={16} color={s.colors.textSecondary} /></Pressable>{expanded === index && <Text selectable style={{ ...s.muted, backgroundColor: s.colors.surfaceHigh, borderRadius: 12, padding: 12 }}>{check.output || 'Completed without command output.'}</Text>}</View>) : <Text style={s.muted}>{run.stage === 'verify' && run.status === 'running' ? 'Running the checks defined by this workflow…' : `${run.definition.checks.length} required ${run.definition.checks.length === 1 ? 'check runs' : 'checks run'} after execution.`}</Text>}</View>;
}
