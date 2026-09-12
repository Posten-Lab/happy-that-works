import React from 'react';
import { ScrollView, View, Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { workflowStageLabel, type WorkflowRun, type WorkflowTask } from '@ahmadposten/talos-wire';
import { loadWorkflowRun, workflowRPC } from '@/workflows/api';
import { WorkflowButton as Button, WorkflowInput as Input, useWorkflowStyles } from '@/workflows/ui';
import { useSetting } from '@/sync/storage';
import { Modal } from '@/modal';

export default function WorkflowRunScreen() {
    const params = useLocalSearchParams<{ id: string; machineId: string }>();
    const id = typeof params.id === 'string' ? params.id : '', machine = typeof params.machineId === 'string' ? params.machineId : '';
    const router = useRouter(), s = useWorkflowStyles();
    const agents = useSetting('agentLibrary').filter(a => a.provider === 'codex');
    const [run, setRun] = React.useState<WorkflowRun | null>(null), [error, setError] = React.useState(''), [note, setNote] = React.useState('');
    const [busy, setBusy] = React.useState(false), [tab, setTab] = React.useState('Plan'), [replacement, setReplacement] = React.useState<string | null>(null);
    const [detail, setDetail] = React.useState<WorkflowTask | null>(null);
    const [expanded, setExpanded] = React.useState<string | null>(null);
    React.useEffect(() => {
        let live = true, loading = false;
        setRun(null);
        const refresh = async () => { if (loading) return; loading = true; try { const value = await loadWorkflowRun(machine, id); if (live) { setRun(value); setError(''); } } catch { if (live) setError('Coordinator unavailable. Showing the last received state. Reconnect the original machine to continue.'); } finally { loading = false; } };
        void refresh(); const timer = setInterval(refresh, 4000); return () => { live = false; clearInterval(timer); };
    }, [machine, id]);
    const action = async (name: string, extra: object = {}) => {
        if (!run || busy) return;
        if (name === 'cancel' && !(await Modal.confirm('Cancel this run?', 'Active work will stop. The worktree, decisions, and evidence are retained.'))) return;
        setBusy(true);
        try { await workflowRPC(machine, 'action', { id, expectedRevision: run.revision, action: name, note, ...extra }); setRun(await loadWorkflowRun(machine, id)); setNote(''); setReplacement(null); setError(''); }
        catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
        finally { setBusy(false); }
    };
    const finished = run?.status === 'complete' || run?.status === 'cancelled';
    const slots = run ? [...run.definition.planners, run.definition.executor, ...run.definition.reviewers] : [];
    const latestReview = run?.tasks.filter(t => t.stage === 'review' && t.round === run.reviewRound) ?? [];
    return <ScrollView style={{ flex: 1, backgroundColor: s.colors.surface }} contentContainerStyle={{ padding: 20, paddingBottom: 80, gap: 18, width: '100%', maxWidth: 1000, alignSelf: 'center' }}>
        <Button label="All workflows" onPress={() => router.push('/workflows' as any)} />
        {error !== '' && <Text accessibilityRole="alert" style={{ ...s.text, color: s.colors.warning }}>{error}</Text>}
        {!run ? <Text style={s.text}>Connecting to the workflow coordinator…</Text> : <>
            <Text style={{ ...s.muted, color: s.colors.accent }}>WORKFLOW RUN · {run.status.replace('_', ' ').toUpperCase()}</Text>
            <Text accessibilityRole="header" style={{ ...s.text, fontSize: 30, lineHeight: 38, fontWeight: '700' }}>{run.definition.name}</Text>
            <Text style={s.text}>{run.task}</Text>
            <View style={s.card}>
                <Text style={{ ...s.text, fontWeight: '700' }}>Plan → Execute → Review</Text>
                <Text style={s.text}>{finished ? run.status === 'complete' ? 'Every required approval and check passed' : 'Run cancelled' : workflowStageLabel[run.stage]}</Text>
                <Text style={s.muted}>Plan v{run.planVersion} · Planning round {run.planningRound}/{run.definition.planningRounds} · Review round {run.reviewRound}/{run.definition.reviewRounds}</Text>
                <Text style={s.muted}>{run.tasks.length}/{run.definition.maxTurns} agent turns · {run.definition.turnMinutes} minutes per turn maximum</Text>
                {run.reason !== '' && <Text style={s.text}>{run.reason}</Text>}
                {!finished && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {run.status === 'running' ? <Button disabled={busy} label="Pause run" onPress={() => void action('pause')} /> : <Button disabled={busy} label="Resume run" onPress={() => void action('resume')} />}
                    <Button disabled={busy} label="Cancel run" onPress={() => void action('cancel')} />
                </View>}
            </View>
            <View style={s.card}><Text style={{ ...s.text, fontWeight: '700' }}>Team</Text>{slots.map(slot => {
                const last = [...run.tasks].reverse().find(t => t.agentId === slot.agent.id);
                return <View key={slot.agent.id} style={{ gap: 4 }}><Text style={s.text}>{slot.agent.name} · {last?.status === 'running' ? 'Working' : last?.result?.decision ?? 'Waiting'}</Text><Text style={s.muted}>{slot.assignment}</Text>{last?.sessionId && <Button label={`Inspect ${slot.agent.name} session`} onPress={() => router.push(`/session/${last.sessionId}` as any)} />}</View>;
            })}</View>
            {!finished && run.status !== 'running' && <View style={s.card}>
                <Text style={{ ...s.text, fontWeight: '700' }}>Your decision</Text>
                <Input label="Clarification or reason for changing the run" value={note} onChange={setNote} multiline />
                <Text style={s.muted}>Resuming an interrupted step may perform more work in the same worktree. Inspect its session first. A revised plan invalidates earlier approvals. Limits are never waived automatically.</Text>
                {run.stage === 'plan_vote' && <Button primary disabled={busy} label="Approve agreed plan" onPress={() => void action('approve_plan')} />}
                <Button disabled={busy || !note.trim()} label="Request revised plan" onPress={() => void action('revise_plan')} />
                <Button disabled={busy || !note.trim()} label="Verify and review current files" onPress={() => void action('retry_review')} />
                <Button disabled={busy} label="Replace a participant" onPress={() => setReplacement(replacement ? null : '')} />
                {replacement !== null && slots.map(slot => <View key={slot.agent.id} style={{ gap: 6 }}><Button label={`Replace ${slot.agent.name}`} onPress={() => setReplacement(slot.agent.id)} />{replacement === slot.agent.id && agents.filter(a => !slots.some(s => s.agent.id === a.id)).map(a => <Button key={a.id} disabled={busy || !note.trim()} label={`Use ${a.name} instead`} onPress={() => void action('replace_agent', { agentId: slot.agent.id, replacement: a })} />)}</View>)}
            </View>}
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>{['Plan', 'Work', 'Review', 'Activity'].map(t => <Button key={t} primary={tab === t} label={t} onPress={() => setTab(t)} />)}</View>
            {tab === 'Plan' && <View style={s.card}><Text style={{ ...s.text, fontWeight: '700' }}>Completion criteria</Text><Text selectable style={s.text}>{run.definition.criteria}</Text><Text style={{ ...s.text, fontWeight: '700' }}>Plan v{run.planVersion}</Text><Text selectable style={s.text}>{run.plan || 'Independent proposals are being prepared.'}</Text>{run.tasks.filter(t => t.stage === 'plan_vote' && t.version === `plan:${run.planVersion}`).map(t => <Text key={t.id} style={s.muted}>{t.agentName}: {t.result?.decision ?? t.status} · {t.result?.summary ?? ''}</Text>)}</View>}
            {tab === 'Work' && <View style={s.card}><Text style={{ ...s.text, fontWeight: '700' }}>Preserved workspace</Text><Text selectable style={s.text}>{run.directory}</Text><Text selectable style={s.muted}>Branch: {run.branch}{'\n'}Base: {run.baseCommit}{'\n'}Verified contents: {run.artifactVersion || 'Not verified yet'}</Text><Text style={s.muted}>All work remains here after completion or cancellation. This workflow does not merge, publish, or deploy.</Text>{run.tasks.filter(t => t.stage === 'execute').map(t => <View key={t.id}><Text style={s.text}>Execution round {t.round}: {t.result?.summary ?? t.status}</Text><Text selectable style={s.muted}>{t.result?.document}</Text></View>)}{run.checks.map((c, i) => <View key={i} style={{ gap: 4 }}><Text style={s.text}>{c.name}: {c.exitCode === 0 ? 'Passed' : 'Failed'}</Text><Text selectable style={s.muted}>{c.output || 'No command output'}</Text></View>)}</View>}
            {tab === 'Review' && <View style={{ gap: 12 }}>{latestReview.length === 0 && <Text style={s.muted}>Review begins after execution and completion checks. Every reviewer assesses the same workspace revision independently.</Text>}{latestReview.map(t => <View key={t.id} style={s.card}><Text style={{ ...s.text, fontWeight: '700' }}>{t.agentName}: {t.result?.decision ?? t.status}</Text><Text style={s.text}>{t.result?.summary}</Text><Text selectable style={s.muted}>Revision: {t.version}</Text>{t.result?.findings.map((f, i) => <View key={i} style={{ gap: 5 }}><Text style={{ ...s.text, fontWeight: '700' }}>{f.blocking ? 'Blocking' : 'Suggestion'} · {f.title}</Text><Text selectable style={s.text}>{f.evidence}</Text><Text selectable style={s.muted}>Required correction: {f.correction}</Text></View>)}</View>)}</View>}
            {tab === 'Activity' && <>
                {[...run.tasks].reverse().map(t => <View key={t.id} style={s.card}><Text style={s.text}>{t.agentName} · {workflowStageLabel[t.stage]} · {t.status}</Text><Text style={s.muted}>{t.result?.summary ?? t.error ?? 'Working on the assigned task.'}</Text><Button label={`Details ${t.agentName} ${t.stage} round ${t.round}`} onPress={async () => { if (expanded === t.id) { setExpanded(null); return; } try { setDetail(await workflowRPC<WorkflowTask>(machine, 'task', { id, taskId: t.id })); setExpanded(t.id); } catch (e) { setError(String(e)); } }} />{expanded === t.id && <><Text selectable style={s.text}>{detail?.id === t.id ? detail.result?.summary : ''}</Text><Text selectable style={s.text}>{detail?.id === t.id ? detail.result?.document : ''}</Text>{detail?.id === t.id && detail.result?.findings.map((f, i) => <Text key={i} selectable style={s.text}>{f.title}{'\n'}{f.evidence}{'\n'}Required correction: {f.correction}</Text>)}<Text selectable style={s.muted}>{detail?.id === t.id ? detail.prompt : ''}</Text>{t.sessionId && <Button label="Open participant session" onPress={() => router.push(`/session/${t.sessionId}` as any)} />}</>}</View>)}
                <View style={s.card}>{[...run.events].reverse().map((e, i) => <Text key={i} style={s.muted}>{new Date(e.at).toLocaleTimeString()} · {e.text}</Text>)}</View>
            </>}
        </>}
    </ScrollView>;
}
