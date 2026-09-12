import React from 'react';
import { ScrollView, View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { WorkflowDefinitionSchema, WorkflowLibrarySchema, workflowEnabled, workflowStageLabel, type WorkflowDefinition, type WorkflowSlot } from '@ahmadposten/talos-wire';
import { useSetting, useAllMachines, storage } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { loadPendingWorkflowStart, savePendingWorkflowStart } from '@/sync/persistence';
import { Modal } from '@/modal';
import { isMachineOnline } from '@/utils/machineUtils';
import { WorkflowButton as Button, WorkflowInput as Input, useWorkflowStyles } from '@/workflows/ui';
import { workflowRPC, type RunSummary } from '@/workflows/api';

export default function WorkflowsScreen() {
    const router = useRouter(), styles = useWorkflowStyles();
    const experiments = useSetting('experiments'), expWorkflows = useSetting('expWorkflows');
    const library = useSetting('workflowLibrary'), agents = useSetting('agentLibrary').filter(a => a.provider === 'codex');
    const machines = useAllMachines({ includeOffline: true });
    const [machineId, setMachineId] = React.useState('');
    const machine = machines.find(m => m.id === machineId) ?? machines.find(m => m.metadata?.workflows?.version === 1);
    const [draft, setDraft] = React.useState<WorkflowDefinition | null>(null), [step, setStep] = React.useState(0);
    const [original, setOriginal] = React.useState<string | null>(null);
    const [picker, setPicker] = React.useState<string | null>(null), [error, setError] = React.useState('');
    const [launch, setLaunch] = React.useState<WorkflowDefinition | null>(null), [task, setTask] = React.useState(''), [directory, setDirectory] = React.useState('');
    const [runs, setRuns] = React.useState<RunSummary[]>([]), [busy, setBusy] = React.useState(false);
    const pending = React.useRef<{ id: string; definition: WorkflowDefinition; task: string; directory: string; machineId: string } | null>(null);
    const [recoveredStart, setRecoveredStart] = React.useState(loadPendingWorkflowStart);
    const retainStart = (value: { id: string; machineId: string } | null) => { savePendingWorkflowStart(value); setRecoveredStart(value); };
    const enabled = workflowEnabled({ experiments, expWorkflows });
    React.useEffect(() => {
        let live = true, loading = false; setRuns([]);
        if (!machine || !isMachineOnline(machine) || !machine.metadata?.workflows) return;
        const refresh = async () => { if (loading) return; loading = true; try { const r = await workflowRPC<RunSummary[]>(machine.id, 'list', {}); if (live) setRuns(r); } catch (e) { if (live) setError(String(e)); } finally { loading = false; } };
        void refresh(); const timer = setInterval(refresh, 5000); return () => { live = false; clearInterval(timer); };
    }, [machine?.id, machine?.active]);
    const startDraft = (existing?: WorkflowDefinition) => {
        if (!existing && agents.length < 5) { setError('Create at least five distinct Codex agents: two planners, one executor, and two reviewers.'); return; }
        const slot = (index: number, assignment: string): WorkflowSlot => ({ agent: agents[index] as WorkflowSlot['agent'], assignment });
        setOriginal(existing ? JSON.stringify(existing) : null);
        setDraft(existing ? structuredClone(existing) : { id: randomUUID(), revision: 1, name: '', description: '', planners: [slot(0, 'Plan the user experience and acceptance criteria.'), slot(1, 'Plan implementation, dependencies, and risks.')], executor: slot(2, 'Implement the agreed plan and address findings.'), reviewers: [slot(3, 'Review correctness and verify the acceptance criteria.'), slot(4, 'Review interface quality, regressions, and operational impact.')], criteria: '', checks: [{ name: 'Required verification', command: '' }], planningRounds: 3, reviewRounds: 3, turnMinutes: 10, maxTurns: 60, approvePlan: false, updatedAt: Date.now() });
        setStep(0); setError('');
    };
    const patch = (x: Partial<WorkflowDefinition>) => setDraft(d => d ? { ...d, ...x } : d);
    const save = () => {
        try {
            if (!workflowEnabled(storage.getState().settings)) throw new Error('Enable Workflows before saving.');
            const current = storage.getState().settings.workflowLibrary;
            if (original && JSON.stringify(current.find(d => d.id === draft!.id)) !== original) throw new Error('This workflow changed elsewhere. Reopen it before editing.');
            const value = WorkflowDefinitionSchema.parse({ ...draft, revision: draft!.revision + (original ? 1 : 0), updatedAt: Date.now() });
            sync.applySettings({ workflowLibrary: WorkflowLibrarySchema.parse([...current.filter(d => d.id !== value.id), value]) }); setDraft(null);
        } catch (e) { setError(e instanceof Error ? e.message : 'Could not save workflow'); }
    };
    const beginRun = async () => {
        if (busy || !machine || !launch) return;
        if (recoveredStart && !pending.current) { setError('Check the earlier start request before starting another run.'); return; }
        setBusy(true); setError('');
        try {
            if (!workflowEnabled(storage.getState().settings)) throw new Error('Enable Workflows before starting.');
            if (!isMachineOnline(machine) || !machine.metadata?.workflows) throw new Error('Connect a machine with workflow support.');
            if (!task.trim() || !directory.trim()) throw new Error('Enter a task and an absolute project path.');
            pending.current ??= { id: randomUUID(), definition: launch, task: task.trim(), directory: directory.trim(), machineId: machine.id };
            const request = pending.current;
            retainStart(request);
            const run = await workflowRPC<{ id: string }>(request.machineId, 'start', request);
            await sync.refreshSessions(); pending.current = null; retainStart(null);
            router.push(`/workflows/${run.id}?machineId=${encodeURIComponent(request.machineId)}` as any);
        } catch (e) { setError(e instanceof Error ? e.message : 'Could not start. Retry uses the same run ID.'); }
        finally { setBusy(false); }
    };
    const reconcileStart = async () => {
        const request = pending.current ?? recoveredStart; if (!request || busy) return;
        setBusy(true);
        try {
            const result = await workflowRPC<{ state: string; id?: string }>(request.machineId, 'start-status', { id: request.id });
            if (result.state === 'created') { pending.current = null; retainStart(null); router.push(`/workflows/${request.id}?machineId=${encodeURIComponent(request.machineId)}` as any); }
            else if (result.state === 'absent') { pending.current = null; retainStart(null); setError('No run was created. You can correct the request and start again.'); }
            else setError('The original request is still starting. Check again shortly.');
        } catch (e) { setError(String(e)); } finally { setBusy(false); }
    };
    const teamSlot = (label: string, slot: WorkflowSlot, update: (s: WorkflowSlot) => void) => <View key={label} style={styles.card}>
        <Text style={{ ...styles.text, fontWeight: '700' }}>{label}</Text>
        <Button label={`${label}: ${slot.agent.name}`} onPress={() => setPicker(picker === label ? null : label)} />
        {picker === label && agents.map(a => <Button key={a.id} label={`Choose ${a.name} for ${label}`} onPress={() => { update({ ...slot, agent: a as WorkflowSlot['agent'] }); setPicker(null); }} />)}
        <Text style={styles.muted}>{slot.agent.model} · {slot.agent.effort ?? 'default'} effort · {label === 'Executor' ? 'Workspace edits' : 'Read-only'}</Text>
        <Input label={`${label} assignment`} value={slot.assignment} onChange={assignment => update({ ...slot, assignment })} multiline />
    </View>;
    return <ScrollView style={{ flex: 1, backgroundColor: styles.colors.surface }} contentContainerStyle={{ padding: 20, gap: 18, width: '100%', maxWidth: 960, alignSelf: 'center', paddingBottom: 70 }}>
        <Text style={{ ...styles.muted, color: styles.colors.accent }}>TALOS LABS · EXPERIMENTAL</Text>
        <Text accessibilityRole="header" style={{ ...styles.text, fontSize: 30, lineHeight: 38, fontWeight: '700' }}>A team with a shared finish line</Text>
        <Text style={styles.muted}>Plan together. Execute with one owner. Review until every required participant approves.</Text>
        {error !== '' && <Text accessibilityRole="alert" style={{ ...styles.text, color: styles.colors.warning }}>{error}</Text>}
        {recoveredStart && !pending.current && <View style={styles.card}><Text style={styles.text}>An earlier start request needs reconciliation. Check its original machine before starting another run.</Text><Button label="Check earlier start request" disabled={busy} onPress={() => void reconcileStart()} /></View>}
        {!enabled ? <View style={styles.card}><Text style={styles.text}>Workflows are experimental</Text><Text style={styles.muted}>Enable Experimental Features and Workflows in Settings → Features. Existing runs continue on their coordinator machine.</Text><Button label="Open Features" onPress={() => router.push('/settings/features')} /></View> : draft ? <>
            <Text style={styles.text}>{step + 1} / 4 · {['Purpose', 'Team', 'Rules and completion', 'Review'][step]}</Text>
            {step === 0 && <View style={styles.card}><Input label="Workflow name" value={draft.name} onChange={name => patch({ name })} max={80} /><Input label="Description" value={draft.description} onChange={description => patch({ description })} multiline max={1000} /></View>}
            {step === 1 && <>
                <Text style={styles.muted}>The first planner owns the consolidated document. Every planner and reviewer must approve; no participant can override another.</Text>
                {draft.planners.map((s, i) => teamSlot(`Planner ${i + 1}`, s, value => patch({ planners: draft.planners.map((old, j) => j === i ? value : old) })))}
                {draft.planners.length < 4 && <Button label="Add planner" onPress={() => patch({ planners: [...draft.planners, { agent: agents[0] as WorkflowSlot['agent'], assignment: 'Independently challenge the plan and identify missing requirements.' }] })} />}
                {draft.planners.length > 2 && <Button label="Remove last planner" onPress={() => patch({ planners: draft.planners.slice(0, -1) })} />}
                {teamSlot('Executor', draft.executor, executor => patch({ executor }))}
                {draft.reviewers.map((s, i) => teamSlot(`Reviewer ${i + 1}`, s, value => patch({ reviewers: draft.reviewers.map((old, j) => j === i ? value : old) })))}
                {draft.reviewers.length < 4 && <Button label="Add reviewer" onPress={() => patch({ reviewers: [...draft.reviewers, { agent: agents[0] as WorkflowSlot['agent'], assignment: 'Independently inspect the result and acceptance evidence.' }] })} />}
                {draft.reviewers.length > 2 && <Button label="Remove last reviewer" onPress={() => patch({ reviewers: draft.reviewers.slice(0, -1) })} />}
            </>}
            {step === 2 && <View style={styles.card}>
                <Input label="Completion criteria" value={draft.criteria} onChange={criteria => patch({ criteria })} multiline />
                <Text style={styles.muted}>Required check commands run on your coordinator machine inside the isolated worktree, with your machine's normal command permissions. Configure only commands you authorize. Every check must exit successfully.</Text>
                {draft.checks.map((c, i) => <View key={i} style={{ gap: 8 }}><Input label={`Check ${i + 1} name`} value={c.name} onChange={name => patch({ checks: draft.checks.map((v, j) => j === i ? { ...v, name } : v) })} max={100} /><Input label={`Check ${i + 1} command`} value={c.command} onChange={command => patch({ checks: draft.checks.map((v, j) => j === i ? { ...v, command } : v) })} max={2000} /></View>)}
                {draft.checks.length < 8 && <Button label="Add completion check" onPress={() => patch({ checks: [...draft.checks, { name: '', command: '' }] })} />}
                {draft.checks.length > 1 && <Button label="Remove last check" onPress={() => patch({ checks: draft.checks.slice(0, -1) })} />}
                {(['planningRounds', 'reviewRounds', 'turnMinutes', 'maxTurns'] as const).map((key, i) => <Input key={key} label={['Planning round limit (1–5)', 'Review round limit (1–5)', 'Minutes per agent turn (1–30)', 'Agent turn limit (8–100)'][i]} value={String(draft[key])} max={3} onChange={v => patch({ [key]: Number(v) })} />)}
                <Button label={draft.approvePlan ? 'Your plan approval: required' : 'Your plan approval: automatic after consensus'} onPress={() => patch({ approvePlan: !draft.approvePlan })} />
            </View>}
            {step === 3 && <View style={styles.card}><Text style={{ ...styles.text, fontWeight: '700' }}>{draft.name || 'Untitled workflow'}</Text><Text style={styles.text}>Plan: {draft.planners.map(s => s.agent.name).join(' + ')}{ '\n'}Execute: {draft.executor.agent.name}{'\n'}Review: {draft.reviewers.map(s => s.agent.name).join(' + ')}</Text><Text style={styles.text}>{draft.criteria}</Text>{draft.checks.map((c, i) => <Text key={i} style={styles.muted}>{c.name}: {c.command}</Text>)}<Text style={styles.muted}>All participants required · {draft.planningRounds} planning rounds · {draft.reviewRounds} review rounds · {draft.maxTurns} agent turns maximum. Definitions are frozen for each run. No automatic merge, publication, or deployment.</Text></View>}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}><Button label="Cancel editing" onPress={() => setDraft(null)} />{step > 0 && <Button label="Back" onPress={() => setStep(step - 1)} />}<Button primary label={step === 3 ? 'Save workflow' : 'Continue'} onPress={() => step === 3 ? save() : setStep(step + 1)} /></View>
        </> : <>
            <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}><Button primary label="Create workflow" onPress={() => startDraft()} /><Button label="Manage agents" onPress={() => router.push('/agents' as any)} /></View>
            {library.map(w => <View key={w.id} style={styles.card}><Text style={{ ...styles.text, fontSize: 21, fontWeight: '700' }}>{w.name}</Text><Text style={styles.muted}>{w.description}</Text><Text style={styles.muted}>{w.planners.length} planners → {w.executor.agent.name} → {w.reviewers.length} reviewers</Text><View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}><Button primary label={`Run ${w.name}`} onPress={() => { if (pending.current) { setError('Resolve the pending start request before starting another workflow.'); return; } setLaunch(structuredClone(w)); setError(''); }} /><Button label={`Edit ${w.name}`} onPress={() => startDraft(w)} /><Button label={`Delete ${w.name}`} onPress={async () => { if (await Modal.confirm('Delete workflow?', 'Existing runs keep their frozen configuration.')) sync.applySettings({ workflowLibrary: storage.getState().settings.workflowLibrary.filter(d => d.id !== w.id) }); }} /></View></View>)}
            <View style={styles.card}><Text style={{ ...styles.text, fontWeight: '700' }}>Coordinator machine</Text><Text style={styles.muted}>Runs continue when you close the app. Keep this machine and its daemon online. Existing runs remain on their original machine.</Text>{machines.map(m => <Button key={m.id} primary={m.id === machine?.id} disabled={!!pending.current} label={`${m.metadata?.displayName || m.metadata?.host || m.id}${!isMachineOnline(m) ? ' · offline' : !m.metadata?.workflows ? ' · CLI update required' : ''}`} onPress={() => setMachineId(m.id)} />)}{!machines.length && <Text style={styles.muted}>Connect a machine to start a workflow.</Text>}</View>
            {launch && <View style={styles.card}><Text style={{ ...styles.text, fontWeight: '700' }}>Run {launch.name}</Text><Input label="Task" value={pending.current?.task ?? task} onChange={v => { if (!pending.current) setTask(v); }} multiline /><Input label="Absolute project path" value={pending.current?.directory ?? directory} onChange={v => { if (!pending.current) setDirectory(v); }} max={4000} /><Text style={styles.muted}>Starts from committed files in a new Git worktree. Your working directory is preserved. {launch.checks.length} authorized completion check(s) will run.</Text>{pending.current && <><Text style={styles.muted}>Start request retained. Retry checks the same run on the original machine.</Text><Button label="Check start status or unlock form" disabled={busy} onPress={() => void reconcileStart()} /></>}<Button primary disabled={busy || !machine || !isMachineOnline(machine) || !machine.metadata?.workflows} label={busy ? 'Starting…' : pending.current ? 'Retry start' : 'Start workflow'} onPress={() => void beginRun()} /></View>}
        </>}
        {!draft && <View style={{ gap: 12 }}><Text style={{ ...styles.text, fontSize: 22, fontWeight: '700' }}>Runs on {machine?.metadata?.host ?? 'your machine'}</Text>{runs.map(r => <View key={r.id} style={styles.card}><Text style={styles.text}>{r.name}</Text><Text style={styles.muted}>{r.task}</Text><Text style={styles.muted}>{r.status.replace('_', ' ')} · {workflowStageLabel[r.stage]}</Text><Button label={`Open run ${r.name}`} onPress={() => router.push(`/workflows/${r.id}?machineId=${encodeURIComponent(r.machineId)}` as any)} /></View>)}</View>}
    </ScrollView>;
}
