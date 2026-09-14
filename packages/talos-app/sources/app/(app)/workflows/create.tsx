import React from 'react';
import { Keyboard, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { workflowEnabled, type WorkflowDefinition } from '@ahmadposten/talos-wire';
import { agentLibrarySettings, allSavedAgents, agentProviders, type AgentDefinition } from '@/agents/agentDefinition';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';
import { storage, useAllMachines, useSetting } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { isMachineOnline } from '@/utils/machineUtils';
import { WorkflowBuilder } from '@/workflows/WorkflowBuilder';
import { WorkflowScaffold, WorkflowPageHeading, WorkflowNotice } from '@/workflows/WorkflowScaffold';
import { editableWorkflow, stepLabels } from '@/workflows/builder';
import { workflowLibrarySettings, workflowSave } from '@/workflows/setup';
import { WorkflowButton as Button, WorkflowAvatar, WorkflowStatusChip, useWorkflowStyles } from '@/workflows/ui';
import { workflowProblemPage, workflowSaveMessage, workflowWizardProblem, workflowWizardSteps, type WorkflowBuilderSection } from '@/workflows/wizard';

const pageCopy = [
    { title: 'Name your workflow', description: 'A clear purpose for a team you’ll use again.' },
    { title: 'Assemble your team', description: 'Plan together. Build with focus. Review independently.' },
    { title: 'Define done', description: 'Set the outcome and the checks that prove it.' },
    { title: 'Review your workflow', description: 'Save it to your library. Run it when you’re ready.' },
] as const;

export default function CreateWorkflowScreen() {
    const router = useRouter(), navigation = useNavigation(), s = useWorkflowStyles();
    const { id } = useLocalSearchParams<{ id?: string }>();
    const experiments = useSetting('experiments'), expWorkflows = useSetting('expWorkflows');
    const savedAgents = useSetting('agentLibrary'), providerAgents = useSetting('agentLibraryV2');
    const machines = useAllMachines({ includeOffline: true });
    const [initial] = React.useState(() => {
        const settings = storage.getState().settings;
        const existing = id ? [...settings.workflowLibrary, ...settings.workflowLibraryV2, ...settings.workflowLibraryV3].find(workflow => workflow.id === id) : undefined;
        const draft = editableWorkflow(existing);
        return { missing: !!id && !existing, original: existing ? JSON.stringify(existing) : null, draft, snapshot: JSON.stringify(draft) };
    });
    const [draft, setDraft] = React.useState<WorkflowDefinition>(initial.draft);
    const [candidates, setCandidates] = React.useState<AgentDefinition[]>([]);
    const [machineId, setMachineId] = React.useState('');
    const machine = machineId ? machines.find(item => item.id === machineId) : machines.find(item => isMachineOnline(item) && (item.metadata?.workflows?.version ?? 0) >= 3) ?? machines.find(isMachineOnline) ?? machines[0];
    const [page, setPage] = React.useState(0), [error, setError] = React.useState('');
    const [leaving, setLeaving] = React.useState(false), [savedId, setSavedId] = React.useState<string | null>(null);
    const saving = React.useRef(false), scroll = React.useRef<ScrollView>(null);
    const dirty = JSON.stringify(draft) !== initial.snapshot;
    const enabled = workflowEnabled({ experiments, expWorkflows });

    usePreventRemove(dirty && !leaving && !savedId, ({ data }) => {
        void Modal.confirm('Leave workflow setup?', 'Your unsaved changes will be discarded.', { confirmText: 'Discard changes', cancelText: 'Keep editing', destructive: true })
            .then(confirmed => { if (confirmed) navigation.dispatch(data.action); });
    });
    React.useEffect(() => {
        if (savedId) router.replace(`/workflows?saved=${encodeURIComponent(savedId)}` as any);
        else if (leaving) router.replace('/workflows' as any);
    }, [savedId, leaving, router]);
    React.useEffect(() => { Keyboard.dismiss(); scroll.current?.scrollTo({ y: 0, animated: false }); }, [page]);

    const go = (next: number) => { setError(''); setPage(next); };
    const showError = (message: string, nextPage = page) => {
        Keyboard.dismiss(); setError(message); setPage(nextPage);
        requestAnimationFrame(() => scroll.current?.scrollTo({ y: 0, animated: true }));
    };
    const cancel = async () => {
        if (!dirty || await Modal.confirm('Leave workflow setup?', 'Your unsaved changes will be discarded.', { confirmText: 'Discard changes', cancelText: 'Keep editing', destructive: true })) setLeaving(true);
    };
    const save = () => {
        if (saving.current) return;
        const problem = workflowWizardProblem(draft, 3);
        if (problem) { showError(problem, workflowProblemPage(draft)); return; }
        saving.current = true;
        try {
            const settings = storage.getState().settings;
            if (!workflowEnabled(settings)) throw new Error('Enable Workflows before saving.');
            const current = [...settings.workflowLibrary, ...settings.workflowLibraryV2, ...settings.workflowLibraryV3];
            if (initial.original && JSON.stringify(current.find(workflow => workflow.id === draft.id)) !== initial.original) throw new Error('This workflow changed elsewhere.');
            const result = workflowSave({ ...draft, revision: draft.revision + (initial.original ? 1 : 0), updatedAt: Date.now() }, candidates, allSavedAgents(settings), current);
            // Validate both collections first, then publish one settings update. Failed saves never leave orphan agents.
            sync.applySettings({ ...workflowLibrarySettings(result.workflowLibrary), ...(candidates.length ? { ...agentLibrarySettings(result.agentLibrary), expAgentLibrary: true } : {}) });
            Keyboard.dismiss(); setSavedId(result.workflow.id);
        } catch (cause) { saving.current = false; showError(workflowSaveMessage(cause)); }
    };
    const next = () => {
        const problem = workflowWizardProblem(draft, page);
        if (problem) { showError(problem); return; }
        go(page + 1);
    };

    if (!enabled || initial.missing) return <WorkflowScaffold>
        <WorkflowPageHeading title={initial.missing ? 'Workflow not found' : 'Workflows are experimental'} description={initial.missing ? 'It may have been removed on another device. Return to your library to choose another workflow.' : 'Enable Workflows in Settings → Features to create a team.'} />
        <Button primary label={initial.missing ? 'Back to workflows' : 'Open Features'} onPress={() => router.replace(initial.missing ? '/workflows' as any : '/settings/features')} />
    </WorkflowScaffold>;

    return <WorkflowScaffold maxWidth={760} scrollRef={scroll} footer={<>
        <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}><Button variant="ghost" label={page === 0 ? 'Cancel' : 'Back'} onPress={() => page === 0 ? void cancel() : go(page - 1)} /></View>
            <View style={{ flex: 2 }}><Button primary label={page === 3 ? initial.original ? 'Save changes' : 'Save workflow' : page === 2 ? 'Review workflow' : 'Continue'} disabled={!!savedId} onPress={page === 3 ? save : next} /></View>
        </View>
    </>}>
        <Stack.Screen options={{ headerTitle: initial.original ? 'Edit workflow' : 'New workflow' }} />
        <View accessibilityLabel={`Step ${page + 1} of 4: ${workflowWizardSteps[page]}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {workflowWizardSteps.map((label, index) => <React.Fragment key={label}>
                {index > 0 && <View style={{ height: 1, flex: 1, minWidth: 4, backgroundColor: index <= page ? s.colors.accent : s.colors.divider }} />}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: index <= page ? s.colors.accentSoft : 'transparent', borderWidth: index > page ? 1 : 0, borderColor: s.colors.divider, alignItems: 'center', justifyContent: 'center' }}>{index < page ? <Ionicons name="checkmark" size={13} color={s.colors.accent} /> : <Text style={{ ...Typography.header(), fontSize: 11, color: index === page ? s.colors.accent : s.colors.textSecondary }}>{index + 1}</Text>}</View>
                    <Text style={{ ...Typography.default(index === page ? 'semiBold' : 'regular'), fontSize: 11, color: index === page ? s.colors.text : s.colors.textSecondary }}>{label}</Text>
                </View>
            </React.Fragment>)}
        </View>
        <WorkflowPageHeading title={pageCopy[page].title} description={pageCopy[page].description} />
        {error !== '' && <WorkflowNotice title="A detail needs your attention" message={error} />}
        {page < 3 ? <WorkflowBuilder section={(['basics', 'team', 'finish'] as WorkflowBuilderSection[])[page]} draft={draft} onChange={value => { setDraft(value); setError(''); }}
            candidates={candidates} onCandidates={setCandidates} agents={[...savedAgents, ...providerAgents]} machine={machine} machines={machines} onMachine={setMachineId}
            onReveal={() => { /* Keep the original stage scroll position when the agent sheet closes. */ }} />
            : <WorkflowReview draft={draft} onEdit={go} />}
    </WorkflowScaffold>;
}

function WorkflowReview({ draft, onEdit }: { draft: WorkflowDefinition; onEdit: (page: number) => void }) {
    const s = useWorkflowStyles();
    const icons = { plan: 'compass-outline', execute: 'code-slash-outline', review: 'checkmark-done-outline' } as const;
    const edit = (label: string, page: number) => <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${label}`} onPress={() => onEdit(page)} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8 }}><Ionicons name="create-outline" size={16} color={s.colors.textSecondary} /><Text style={{ ...s.muted, fontSize: 13, ...Typography.default('semiBold') }}>Edit</Text></Pressable>;
    return <View style={{ gap: 30 }}>
        <View style={{ gap: 14, borderBottomWidth: 1, borderColor: s.colors.divider, paddingBottom: 26 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: s.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="git-network-outline" size={24} color={s.colors.accent} /></View><Text style={{ ...s.text, ...Typography.header(), fontSize: 24, lineHeight: 30, flex: 1 }}>{draft.name}</Text>{edit('workflow basics', 0)}</View>
            {!!draft.description && <Text style={s.muted}>{draft.description}</Text>}
            <WorkflowStatusChip label={`${draft.steps!.length} stages · ${new Set(draft.steps!.flatMap(step => step.agents.map(slot => slot.agent.id))).size} agents`} />
        </View>
        <View style={{ gap: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}><Text style={{ ...s.text, ...Typography.header(), fontSize: 18, flex: 1 }}>Your team</Text>{edit('workflow team', 1)}</View>
            {draft.steps!.map((step, index) => <View key={step.id} style={{ flexDirection: 'row', gap: 14 }}>
                <View style={{ width: 32, alignItems: 'center' }}><View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: s.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icons[step.kind]} size={17} color={s.colors.accent} /></View>{index < draft.steps!.length - 1 && <View style={{ width: 1, flex: 1, minHeight: 12, backgroundColor: s.colors.divider, marginTop: 10 }} />}</View>
                <View style={{ flex: 1, gap: 10, paddingBottom: index < draft.steps!.length - 1 ? 14 : 0 }}><View style={{ flexDirection: 'row', gap: 8, alignItems: 'baseline' }}><Text style={{ ...s.text, ...Typography.header(), fontSize: 16 }}>{step.name}</Text>{step.name.trim().toLowerCase() !== stepLabels[step.kind].toLowerCase() && <Text style={{ ...s.muted, fontSize: 11 }}>{stepLabels[step.kind]}</Text>}</View>
                    {step.agents.map(slot => <View key={slot.agent.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><WorkflowAvatar name={slot.agent.name} provider={slot.agent.provider} size={28} /><View style={{ flex: 1, gap: 1 }}><Text style={{ ...s.text, ...Typography.default('semiBold'), fontSize: 14 }}>{slot.agent.name}</Text><Text style={{ ...s.muted, fontSize: 12, lineHeight: 18 }}>{agentProviders.find(provider => provider.code === slot.agent.provider)?.name} · {slot.agent.modelLabel || (slot.agent.model === 'default' ? 'Provider default' : slot.agent.model)}{slot.agent.effort ? ` · ${slot.agent.effort}` : ''}</Text></View></View>)}
                </View>
            </View>)}
        </View>
        <View style={{ gap: 16, borderTopWidth: 1, borderColor: s.colors.divider, paddingTop: 22 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}><Text style={{ ...s.text, ...Typography.header(), fontSize: 18, flex: 1 }}>The finish line</Text>{edit('workflow finish line', 2)}</View>
            <Text style={{ ...s.text, lineHeight: 26 }}>{draft.criteria}</Text>
            {draft.checks.map((check, index) => <View key={index} style={{ gap: 8, paddingVertical: 14, paddingHorizontal: 16, backgroundColor: s.colors.surface, borderRadius: 12 }}><View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><Ionicons name="terminal-outline" size={16} color={s.colors.textSecondary} /><Text style={{ ...s.text, fontSize: 13, ...Typography.default('semiBold') }}>{check.name}</Text></View><Text selectable style={{ ...s.muted, ...Typography.mono(), fontSize: 12 }}>{check.command}</Text></View>)}
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingTop: 4 }}><Ionicons name={draft.approvePlan ? 'hand-left-outline' : 'checkmark-circle-outline'} size={18} color={s.colors.accent} /><Text style={{ ...s.muted, fontSize: 13, flex: 1 }}>{draft.approvePlan ? 'Waits for your approval after planning.' : 'Continues automatically after planning consensus.'}</Text></View>
            <Text style={{ ...s.muted, fontSize: 12 }}>{draft.planningRounds} planning rounds · {draft.reviewRounds} review rounds · {draft.maxTurns} turns total · {draft.turnMinutes} min per turn</Text>
        </View>
    </View>;
}
