import React from 'react';
import { ScrollView, View, Text, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { workflowEnabled, workflowStageLabel, type WorkflowDefinition } from '@ahmadposten/talos-wire';
import { useSetting, useAllMachines, storage } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { loadPendingWorkflowStart, savePendingWorkflowStart } from '@/sync/persistence';
import { Modal } from '@/modal';
import { isMachineOnline } from '@/utils/machineUtils';
import { WorkflowButton as Button, WorkflowInput as Input, useWorkflowStyles } from '@/workflows/ui';
import { workflowRPC, type RunSummary } from '@/workflows/api';
import type { AgentDefinition } from '@/agents/agentDefinition';
import { WorkflowBuilder } from '@/workflows/WorkflowBuilder';
import { editableWorkflow } from '@/workflows/builder';
import { workflowSave, workflowLibrarySettings } from '@/workflows/setup';

export default function WorkflowsScreen() {
    const router = useRouter(), styles = useWorkflowStyles();
    const experiments = useSetting('experiments'), expWorkflows = useSetting('expWorkflows');
    const legacyLibrary = useSetting('workflowLibrary'), editableLibrary = useSetting('workflowLibraryV2'), agentLibrary = useSetting('agentLibrary');
    const library = [...legacyLibrary, ...editableLibrary];
    const machines = useAllMachines({ includeOffline: true });
    const [machineId, setMachineId] = React.useState('');
    const machine = machineId ? machines.find(m => m.id === machineId) : machines.find(m => isMachineOnline(m) && (m.metadata?.workflows?.version ?? 0) >= 1) ?? machines[0];
    const [draft, setDraft] = React.useState<WorkflowDefinition | null>(null);
    const [starterAgents, setStarterAgents] = React.useState<AgentDefinition[]>([]);
    const scroll = React.useRef<ScrollView>(null);
    const content = React.useRef<View>(null!);
    const [original, setOriginal] = React.useState<string | null>(null);
    const [error, setError] = React.useState('');
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
    React.useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [!!draft, launch?.id, error]);
    const startDraft = (existing?: WorkflowDefinition) => {
        if (recoveredStart || pending.current) { setError('Check the earlier start request before creating or editing a workflow.'); return; }
        setOriginal(existing ? JSON.stringify(existing) : null);
        setStarterAgents([]); setLaunch(null);
        setDraft(editableWorkflow(existing));
        setError('');
    };
    const save = () => {
        try {
            if (!workflowEnabled(storage.getState().settings)) throw new Error('Enable Workflows before saving.');
            const settings = storage.getState().settings;
            const current = [...settings.workflowLibrary, ...settings.workflowLibraryV2];
            if (original && JSON.stringify(current.find(d => d.id === draft!.id)) !== original) throw new Error('This workflow changed elsewhere. Reopen it before editing.');
            const saved = workflowSave({ ...draft!, revision: draft!.revision + (original ? 1 : 0), updatedAt: Date.now() }, starterAgents, storage.getState().settings.agentLibrary, current);
            sync.applySettings({ ...workflowLibrarySettings(saved.workflowLibrary), ...(starterAgents.length ? { agentLibrary: saved.agentLibrary, expAgentLibrary: true } : {}) });
            setDraft(null); setStarterAgents([]); setLaunch(saved.workflow); setError('');
        } catch (e) { setError(e instanceof Error ? e.message : 'Could not save workflow'); }
    };
    const beginRun = async () => {
        if (busy || !machine || !launch) return;
        if (recoveredStart && !pending.current) { setError('Check the earlier start request before starting another run.'); return; }
        setBusy(true); setError('');
        try {
            if (!workflowEnabled(storage.getState().settings)) throw new Error('Enable Workflows before starting.');
            if (!isMachineOnline(machine) || !machine.metadata?.workflows) throw new Error('Connect a machine with workflow support.');
            if (launch.steps && (machine.metadata?.workflows?.version ?? 0) < 2) throw new Error('Update the coordinator CLI to run editable stages.');
            if (!task.trim() || !directory.trim()) throw new Error('Enter a task and an absolute project path.');
            pending.current ??= { id: randomUUID(), definition: launch, task: task.trim(), directory: directory.trim(), machineId: machine.id };
            const request = pending.current;
            retainStart(request);
            const run = await workflowRPC<{ id: string }>(request.machineId, request.definition.steps ? 'start-v2' : 'start', request);
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
    return <ScrollView ref={scroll} innerViewRef={Platform.OS === 'web' ? undefined : content} keyboardShouldPersistTaps="handled" style={{ flex: 1, backgroundColor: styles.colors.surface }} contentContainerStyle={{ padding: 20, gap: 18, width: '100%', maxWidth: 960, alignSelf: 'center', paddingBottom: 70 }}>
        <Text style={{ ...styles.muted, color: styles.colors.accent }}>TALOS LABS · EXPERIMENTAL</Text>
        <Text accessibilityRole="header" style={{ ...styles.text, fontSize: 30, lineHeight: 38, fontWeight: '700' }}>A team with a shared finish line</Text>
        <Text style={styles.muted}>Build a sequence of planning, execution, and review steps. Choose the agents and the finish line.</Text>
        {error !== '' && <Text accessibilityRole="alert" style={{ ...styles.text, color: styles.colors.warning }}>{error}</Text>}
        {recoveredStart && !pending.current && <View style={styles.card}><Text style={styles.text}>An earlier start request needs reconciliation. Check its original machine before starting another run.</Text><Button label="Check earlier start request" disabled={busy} onPress={() => void reconcileStart()} /></View>}
        {!enabled ? <View style={styles.card}><Text style={styles.text}>Workflows are experimental</Text><Text style={styles.muted}>Enable Experimental Features and Workflows in Settings → Features. Existing runs continue on their coordinator machine.</Text><Button label="Open Features" onPress={() => router.push('/settings/features')} /></View> : draft ? <WorkflowBuilder onReveal={node => { const container = content.current ?? scroll.current?.getInnerViewNode(); if (node && container) node.measureLayout(container, (_x, y) => scroll.current?.scrollTo({ y: Math.max(0, y - 12), animated: false })); }} draft={draft} onChange={setDraft} candidates={starterAgents} onCandidates={setStarterAgents} agents={agentLibrary} machine={machine} machines={machines} onMachine={setMachineId} onSave={save} onCancel={() => { setDraft(null); setStarterAgents([]); setError(''); }} /> : launch ? <View style={styles.card}><Text style={{ ...styles.text, fontWeight: '700' }}>Run {launch.name}</Text><Text style={styles.muted}>Choose where to run, then enter the task and project. Nothing starts until you press Start workflow.</Text>
                <Text style={{ ...styles.text, fontWeight: '700' }}>Coordinator machine</Text>
                {machines.map(m => <Button key={m.id} selected={m.id === machine?.id} disabled={!!pending.current || busy} label={`${m.metadata?.displayName || m.metadata?.host || m.id}${!isMachineOnline(m) ? ' · offline' : (m.metadata?.workflows?.version ?? 0) < (launch?.steps ? 2 : 1) ? ' · CLI update required' : ''}`} onPress={() => { setMachineId(m.id); setError(''); }} />)}
                {!machine ? <Text accessibilityRole="alert" style={styles.text}>Connect a machine using the Talos CLI.</Text> : !isMachineOnline(machine) ? <Text accessibilityRole="alert" style={styles.text}>This machine is offline. Start its Talos daemon or select an online machine.</Text> : (machine.metadata?.workflows?.version ?? 0) < (launch?.steps ? 2 : 1) ? <Text accessibilityRole="alert" style={styles.text}>Update this machine’s Talos CLI and restart its daemon to enable workflows.</Text> : <Text style={styles.muted}>Selected: {machine.metadata?.displayName || machine.metadata?.host || machine.id}. Keep this machine online while the workflow runs.</Text>}
                <Input label="Task" value={pending.current?.task ?? task} onChange={v => { if (!pending.current) setTask(v); }} multiline /><Input label="Absolute project path" value={pending.current?.directory ?? directory} onChange={v => { if (!pending.current) setDirectory(v); }} max={4000} /><Text style={styles.muted}>Starts from committed files in a new Git worktree. Your working directory is preserved. {launch.checks.length} authorized completion check(s) will run.</Text>{pending.current && <><Text style={styles.muted}>Start request retained. Retry checks the same run on the original machine.</Text><Button label="Check start status or unlock form" disabled={busy} onPress={() => void reconcileStart()} /></>}<Button primary disabled={busy || !machine || !isMachineOnline(machine) || (machine.metadata?.workflows?.version ?? 0) < (launch?.steps ? 2 : 1) || !!recoveredStart && !pending.current} label={busy ? 'Starting…' : pending.current ? 'Retry start' : 'Start workflow'} onPress={() => void beginRun()} /><Button label="Back to workflows" disabled={busy || !!recoveredStart} onPress={() => { setLaunch(null); setError(''); }} /></View> : <>
            <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}><Button primary label="Create workflow" onPress={() => startDraft()} /><Button label="Manage agents" onPress={() => router.push('/agents' as any)} /></View>
            {library.map(w => <View key={w.id} style={styles.card}><Text style={{ ...styles.text, fontSize: 21, fontWeight: '700' }}>{w.name}</Text><Text style={styles.muted}>{w.description}</Text><Text style={styles.muted}>{w.steps ? w.steps.map(s => `${s.name} (${s.agents.length})`).join(' → ') : `${w.planners.length} planners → ${w.executor.agent.name} → ${w.reviewers.length} reviewers`}</Text><View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}><Button primary label={`Run ${w.name}`} onPress={() => { if (recoveredStart || pending.current) { setError('Resolve the pending start request before starting another workflow.'); return; } setLaunch(structuredClone(w)); setError(''); }} /><Button label={`Edit ${w.name}`} onPress={() => startDraft(w)} /><Button label={`Delete ${w.name}`} onPress={async () => { if (await Modal.confirm('Delete workflow?', 'Existing runs keep their frozen configuration.')) sync.applySettings(workflowLibrarySettings([...storage.getState().settings.workflowLibrary, ...storage.getState().settings.workflowLibraryV2].filter(d => d.id !== w.id))); }} /></View></View>)}
            <View style={styles.card}><Text style={{ ...styles.text, fontWeight: '700' }}>View runs on</Text><Text style={styles.muted}>Select a machine to see its run history. To start a new run, choose a saved workflow above.</Text>{machines.map(m => <Button key={m.id} selected={m.id === machine?.id} disabled={!!pending.current} label={`${m.metadata?.displayName || m.metadata?.host || m.id}${!isMachineOnline(m) ? ' · offline' : !m.metadata?.workflows ? ' · CLI update required' : ''}`} onPress={() => setMachineId(m.id)} />)}{!machines.length && <Text style={styles.muted}>Connect a machine to start a workflow.</Text>}</View>

        </>}
        {!draft && !launch && <View style={{ gap: 12 }}><Text style={{ ...styles.text, fontSize: 22, fontWeight: '700' }}>Runs on {machine?.metadata?.host ?? 'your machine'}</Text>{runs.map(r => <View key={r.id} style={styles.card}><Text style={styles.text}>{r.name}</Text><Text style={styles.muted}>{r.task}</Text><Text style={styles.muted}>{r.status.replace('_', ' ')} · {workflowStageLabel[r.stage]}</Text><Button label={`Open run ${r.name}`} onPress={() => router.push(`/workflows/${r.id}?machineId=${encodeURIComponent(r.machineId)}` as any)} /></View>)}</View>}
    </ScrollView>;
}
