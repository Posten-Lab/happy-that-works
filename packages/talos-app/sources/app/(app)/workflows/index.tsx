import React from 'react';
import { ActivityIndicator, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { workflowEnabled, workflowStageLabel, type WorkflowDefinition } from '@ahmadposten/talos-wire';
import { useSetting, useAllMachines, storage } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { loadPendingWorkflowStart } from '@/sync/persistence';
import { Modal } from '@/modal';
import { isMachineOnline } from '@/utils/machineUtils';
import { Typography } from '@/constants/Typography';
import { HomeTabBar } from '@/components/HomeTabBar';
import { WorkflowButton as Button, WorkflowAvatar, WorkflowStatusChip, useWorkflowStyles } from '@/workflows/ui';
import { WorkflowScaffold, WorkflowPageHeading, WorkflowNotice } from '@/workflows/WorkflowScaffold';
import { workflowRPC, type RunSummary } from '@/workflows/api';
import { workflowLibrarySettings } from '@/workflows/setup';
import { workflowErrorMessage } from '@/workflows/errors';
import { agentLibraryEnabled } from '@/agents/agentDefinition';

export default function WorkflowsScreen() {
    const router = useRouter(), s = useWorkflowStyles(), window = useWindowDimensions();
    const params = useLocalSearchParams<{ saved?: string }>();
    const experiments = useSetting('experiments'), expWorkflows = useSetting('expWorkflows');
    const expAgentLibrary = useSetting('expAgentLibrary');
    const legacy = useSetting('workflowLibrary'), editable = useSetting('workflowLibraryV2'), providers = useSetting('workflowLibraryV3'), extended = useSetting('workflowLibraryV4');
    const library = [...legacy, ...editable, ...providers, ...extended].sort((a, b) => b.updatedAt - a.updatedAt);
    const machines = useAllMachines({ includeOffline: true });
    const [tab, setTab] = React.useState<'library' | 'runs'>('library');
    const [runs, setRuns] = React.useState<RunSummary[]>([]);
    const [failures, setFailures] = React.useState<string[]>([]);
    const [loading, setLoading] = React.useState(false), [retry, setRetry] = React.useState(0);
    const [error, setError] = React.useState('');
    const enabled = workflowEnabled({ experiments, expWorkflows });
    const pending = loadPendingWorkflowStart();
    const saved = library.find(w => w.id === params.saved);
    // History is independent of designing and launching saved workflows. One offline
    // machine must not hide another machine's runs or flood the library with errors.
    const machineKey = machines.map(m => `${m.id}:${isMachineOnline(m)}:${m.metadata?.workflows?.version ?? 0}`).sort().join('|');
    React.useEffect(() => {
        if (!enabled || tab !== 'runs') return;
        let live = true;
        const refreshing = new Set<string>();
        const available = machines.filter(m => isMachineOnline(m) && m.metadata?.workflows);
        const received = new Map<string, RunSummary[]>();
        const failed = new Set<string>();
        const refresh = async () => {
            await Promise.allSettled(available.map(async machine => {
                if (refreshing.has(machine.id)) return;
                refreshing.add(machine.id);
                try {
                    const latest = await workflowRPC<RunSummary[]>(machine.id, 'list', {});
                    if (!live) return;
                    received.set(machine.id, latest); failed.delete(machine.id);
                } catch {
                    if (!live) return;
                    failed.add(machine.id);
                } finally { refreshing.delete(machine.id); }
                if (live) {
                    // Publish each machine immediately; a slow peer cannot hide a healthy machine.
                    setRuns([...received.values()].flat().sort((a, b) => b.updatedAt - a.updatedAt));
                    setFailures(available.filter(item => failed.has(item.id)).map(item => item.metadata?.displayName || item.metadata?.host || 'A machine'));
                    setLoading(false);
                }
            }));
            if (live) setLoading(false);
        };
        setRuns([]);
        setLoading(true); setFailures([]); void refresh();
        const timer = setInterval(refresh, 5000);
        return () => { live = false; clearInterval(timer); };
    }, [enabled, tab, machineKey, retry]);
    const remove = async (workflow: WorkflowDefinition) => {
        if (!await Modal.confirm(`Delete ${workflow.name}?`, 'Past and active runs keep their configuration and work.')) return;
        try {
            const current = storage.getState().settings;
            sync.applySettings(workflowLibrarySettings([...current.workflowLibrary, ...current.workflowLibraryV2, ...current.workflowLibraryV3, ...current.workflowLibraryV4].filter(w => w.id !== workflow.id)));
        } catch (e) { setError(workflowErrorMessage(e, 'The workflow could not be deleted. Try again.')); }
    };
    const online = machines.filter(m => isMachineOnline(m) && m.metadata?.workflows);
    return <View style={{ flex: 1 }}>
        <WorkflowScaffold>
            <View style={{ gap: 12 }}><WorkflowStatusChip label="Experimental" /><WorkflowPageHeading title="Workflows" description="Your teams for planning, building and review." /></View>
            {!enabled ? <WorkflowNotice title="Try Workflows" message="Enable Experimental Features and Workflows in Settings to build a team that plans, executes, and reviews together." action="Open Features" onAction={() => router.push('/settings/features')} /> : <>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <Pressable accessibilityRole="button" accessibilityLabel="Create workflow" onPress={() => router.push('/workflows/create')}
                        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: s.colors.divider, backgroundColor: pressed ? s.colors.surfacePressed : s.colors.surface })}>
                        <Ionicons name="add" size={20} color={s.colors.accent} /><Text style={{ ...s.text, ...Typography.header(), fontSize: 15 }}>Create workflow</Text>
                    </Pressable>
                    {agentLibraryEnabled({ experiments, expAgentLibrary }) && <Pressable accessibilityRole="button" accessibilityLabel="Manage agents" onPress={() => router.push('/agents')} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 }}><Text style={{ ...s.muted, ...Typography.header() }}>Agent library</Text></Pressable>}
                </View>
                {!!error && <WorkflowNotice title="Couldn't update workflows" message={error} action="Dismiss" onAction={() => setError('')} />}
                {pending && <WorkflowNotice title="Check your last run" message="A start request is waiting for confirmation. Check its status before starting another run." action="Check start status" onAction={() => router.push('/workflows/run')} />}
                {saved && tab === 'library' && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Ionicons name="checkmark-circle" size={18} color={s.colors.success} /><Text accessibilityLiveRegion="polite" style={s.muted}>{saved.name} is saved and ready to run.</Text></View>}
                <View accessibilityRole="tablist" style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: s.colors.divider }}>
                    {([{ id: 'library', label: 'My workflows' }, { id: 'runs', label: 'Recent runs' }] as const).map(item => <Pressable key={item.id} accessibilityRole="tab" aria-selected={tab === item.id} accessibilityState={{ selected: tab === item.id }} accessibilityLabel={item.label} onPress={() => setTab(item.id)} style={{ minHeight: 46, paddingHorizontal: 16, paddingBottom: 12, justifyContent: 'center', borderBottomWidth: 2, borderColor: tab === item.id ? s.colors.accent : 'transparent' }}><Text style={{ ...s.text, ...Typography.header(), fontSize: 14, color: tab === item.id ? s.colors.text : s.colors.textSecondary }}>{item.label}{item.id === 'library' && library.length ? ` · ${library.length}` : ''}</Text></Pressable>)}
                </View>
                {tab === 'library' ? <>
                    {!library.length && <View style={{ ...s.card, paddingVertical: 30, gap: 22 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 }}>{(['compass-outline', 'code-slash-outline', 'checkmark-done-outline'] as const).map((icon, index) => <React.Fragment key={icon}>{index > 0 && <View style={{ height: 1, width: 18, backgroundColor: s.colors.divider }} />}<View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: s.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icon} size={24} color={s.colors.accent} /></View></React.Fragment>)}</View>
                        <View style={{ gap: 8 }}><Text accessibilityRole="header" style={{ ...s.text, ...Typography.header(), fontSize: 21, textAlign: 'center' }}>Your team, ready for repeat work</Text><Text style={{ ...s.muted, textAlign: 'center' }}>Planners agree on a plan. An executor builds it. Reviewers check the result.</Text></View>
                        <Text style={{ ...s.muted, textAlign: 'center', fontSize: 12 }}>Choose Create workflow to set up your first team in four steps.</Text>
                    </View>}
                    <View style={{ flexDirection: window.width >= 1000 ? 'row' : 'column', flexWrap: 'wrap', gap: 16 }}>{library.map(w => <View key={w.id} style={{ width: window.width >= 1000 ? '48.8%' : '100%' }}><WorkflowCard workflow={w} onRun={() => router.push({ pathname: '/workflows/run', params: { workflowId: w.id } })} onEdit={() => router.push({ pathname: '/workflows/create', params: { id: w.id } })} onDelete={() => void remove(w)} /></View>)}</View>
                </> : <>
                    {loading && <ActivityIndicator accessibilityLabel="Loading workflow runs" color={s.colors.accent} />}
                    {failures.length > 0 && <WorkflowNotice title="Some runs couldn't be loaded" message={`Reconnect ${failures.join(', ')} to see its latest runs. Runs on other machines are shown below.`} action="Try again" onAction={() => setRetry(v => v + 1)} />}
                    {!online.length && <WorkflowNotice title="Connect a machine to see runs" message="Run history stays on the machine that started it. Bring that machine online, then check here again." action="View machines" onAction={() => router.push('/settings')} />}
                    {!loading && online.length > 0 && !runs.length && !failures.length && <View style={s.card}><Text style={{ ...s.text, ...Typography.header() }}>No runs yet</Text><Text style={s.muted}>Choose a saved workflow from My workflows, add a task and a project, then start.</Text><Button label="Choose a workflow" onPress={() => setTab('library')} /></View>}
                    {runs.map(r => <Pressable key={r.id} accessibilityRole="button" accessibilityLabel={`Open run ${r.name}`} onPress={() => router.push({ pathname: '/workflows/[id]', params: { id: r.id, machineId: r.machineId } })} style={({ pressed }) => ({ ...s.card, backgroundColor: pressed ? s.colors.surfacePressed : s.colors.surface })}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><View style={{ flex: 1, gap: 5 }}><Text style={{ ...s.text, ...Typography.header() }}>{r.name}</Text><Text style={s.muted} numberOfLines={2}>{r.task}</Text></View><Ionicons name="chevron-forward" size={18} color={s.colors.textSecondary} /></View>
                        <Text style={{ ...s.muted, fontSize: 12 }}>{r.status.replaceAll('_', ' ')} · {workflowStageLabel[r.stage]} · {machines.find(m => m.id === r.machineId)?.metadata?.displayName || machines.find(m => m.id === r.machineId)?.metadata?.host || 'Machine'}</Text>
                    </Pressable>)}
                </>}
            </>}
        </WorkflowScaffold>
        <HomeTabBar activeTab="workflows" />
    </View>;
}

function WorkflowCard({ workflow: w, onRun, onEdit, onDelete }: { workflow: WorkflowDefinition; onRun: () => void; onEdit: () => void; onDelete: () => void }) {
    const s = useWorkflowStyles();
    const [menu, setMenu] = React.useState(false);
    const steps = w.steps ?? [{ name: 'Plan', kind: 'plan', agents: w.planners }, { name: 'Build', kind: 'execute', agents: [w.executor] }, { name: 'Review', kind: 'review', agents: w.reviewers }];
    const agents = [...new Map(steps.flatMap(step => step.agents.map(slot => [slot.agent.id, slot.agent] as const))).values()];
    return <View style={{ ...s.card, borderRadius: 16, gap: 20, padding: 20 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
            <View style={{ flex: 1, gap: 6 }}><Text accessibilityRole="header" style={{ ...s.text, ...Typography.header(), fontSize: 21, lineHeight: 27, letterSpacing: -0.3 }}>{w.name}</Text>{!!w.description && <Text numberOfLines={2} style={s.muted}>{w.description}</Text>}</View>
            <Pressable accessibilityRole="button" accessibilityLabel={`Options for ${w.name}`} accessibilityState={{ expanded: menu }} onPress={() => setMenu(!menu)} style={{ minHeight: 44, minWidth: 44, marginTop: -8, marginRight: -10, justifyContent: 'center', alignItems: 'center' }}><Ionicons name="ellipsis-horizontal" size={20} color={s.colors.textSecondary} /></Pressable>
        </View>
        {menu && <View style={{ flexDirection: 'row', gap: 8 }}><Button variant="ghost" icon="create-outline" label="Edit workflow" accessibilityLabel={`Edit ${w.name}`} onPress={onEdit} /><Button variant="danger" icon="trash-outline" label="Delete" accessibilityLabel={`Delete ${w.name}`} onPress={onDelete} /></View>}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>{steps.map((step, i) => <React.Fragment key={i}>{i > 0 && <Ionicons name="chevron-forward" size={11} color={s.colors.textSecondary} />}<View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><Ionicons name={step.kind === 'plan' ? 'compass-outline' : step.kind === 'execute' ? 'code-slash-outline' : 'checkmark-done-outline'} size={14} color={s.colors.accent} /><Text style={{ ...s.muted, fontSize: 12 }}>{step.name}</Text></View></React.Fragment>)}</View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center', borderTopWidth: 1, borderColor: s.colors.divider, paddingTop: 16 }}>
            <View style={{ flex: 1, minWidth: agents.length > 4 ? 168 : Math.max(100, agents.length * 32 - 4), gap: 7 }}><View style={{ flexDirection: 'row', gap: 4 }}>{agents.slice(0, 4).map(agent => <WorkflowAvatar key={agent.id} name={agent.name} provider={agent.provider} size={28} />)}{agents.length > 4 && <Text style={s.muted}>+{agents.length - 4}</Text>}</View><Text style={{ ...s.muted, fontSize: 12, lineHeight: 17 }} numberOfLines={1}>{agents.map(a => a.name).join(', ')}</Text></View>
            <View style={{ marginLeft: 'auto' }}><Button primary compact icon="play" label="Run workflow" accessibilityLabel={`Run ${w.name}`} onPress={onRun} /></View>
        </View>
    </View>;
}
