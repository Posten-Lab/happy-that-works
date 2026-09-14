import React from 'react';
import { Keyboard, Platform, Pressable, Text, TextInput, View, useWindowDimensions, type ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { randomUUID } from 'expo-crypto';
import { workflowEnabled, type WorkflowDefinition } from '@ahmadposten/talos-wire';
import { PickerContent, PathPickerContent, type PickerItem } from '@/components/SessionDestinationPicker';
import { BaseModal } from '@/modal/components/BaseModal';
import { storage, useAllMachines, useSessions, useSetting } from '@/sync/storage';
import { loadPendingWorkflowStart, savePendingWorkflowStart } from '@/sync/persistence';
import { sync } from '@/sync/sync';
import { formatLastSeen, formatPathRelativeToHome } from '@/utils/sessionUtils';
import { isMachineOnline } from '@/utils/machineUtils';
import { workflowRPC } from '@/workflows/api';
import { workflowErrorMessage } from '@/workflows/errors';
import { inspectWorkflowStart, prepareWorkflowStart, workflowMachineIssue, workflowStartMethod, settleWorkflowStart, sameWorkflowStart, type PendingWorkflowStart, type WorkflowStartRequest } from '@/workflows/launch';
import { WorkflowButton, useWorkflowStyles } from '@/workflows/ui';
import { WorkflowScaffold, WorkflowNotice, WorkflowPageHeading } from '@/workflows/WorkflowScaffold';

/** A launch has its own state. Opening a workflow never changes an unfinished regular-session draft. */
export default function RunWorkflowScreen() {
    const params = useLocalSearchParams<{ workflowId?: string; machineId?: string }>();
    const workflowId = typeof params.workflowId === 'string' ? params.workflowId : '';
    const router = useRouter(), s = useWorkflowStyles(), window = useWindowDimensions();
    const focused = useIsFocused(), focusedRef = React.useRef(focused); focusedRef.current = focused;
    const experiments = useSetting('experiments'), expWorkflows = useSetting('expWorkflows');
    const legacy = useSetting('workflowLibrary'), editable = useSetting('workflowLibraryV2'), providers = useSetting('workflowLibraryV3');
    const workflow = [...legacy, ...editable, ...providers].find(item => item.id === workflowId);
    const enabled = workflowEnabled({ experiments, expWorkflows });
    const machines = useAllMachines({ includeOffline: true }), sessions = useSessions();
    const [machineId, setMachineId] = React.useState(typeof params.machineId === 'string' ? params.machineId : '');
    const [paths, setPaths] = React.useState<Record<string, string>>({});
    const [task, setTask] = React.useState(''), [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState(''), [notice, setNotice] = React.useState('');
    const [picker, setPicker] = React.useState<'machine' | 'project' | null>(null);
    const [keyboardHeight, setKeyboardHeight] = React.useState(0);
    const [receipt, setReceipt] = React.useState(loadPendingWorkflowStart);
    const pending = React.useRef<WorkflowStartRequest | null>(null);
    const inFlight = React.useRef(false), mounted = React.useRef(true);
    const prompt = React.useRef<TextInput>(null);
    const scroll = React.useRef<ScrollView>(null);
    React.useEffect(() => { if (error || notice) scroll.current?.scrollTo({ y: 0, animated: true }); }, [error, notice]);
    React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    React.useEffect(() => {
        if (!focused) return;
        const current = loadPendingWorkflowStart();
        setReceipt(current);
        if (!sameWorkflowStart(pending.current, current)) pending.current = null;
    }, [focused]);
    React.useEffect(() => {
        const shown = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow', event => setKeyboardHeight(Math.max(0, window.height - event.endCoordinates.screenY)));
        const hidden = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardHeight(0));
        return () => { shown.remove(); hidden.remove(); };
    }, [window.height]);
    const effectiveMachineId = receipt?.machineId ?? machineId;
    const machine = machines.find(item => item.id === effectiveMachineId) ?? (effectiveMachineId ? null : machines.find(item => workflow && !workflowMachineIssue(workflow, item)) ?? machines.find(isMachineOnline) ?? machines[0]);
    React.useEffect(() => { if (!machineId && !receipt && machine) setMachineId(machine.id); }, [machineId, receipt, machine?.id]);
    const selectedMachineId = machine?.id ?? effectiveMachineId;
    const projectItems = React.useMemo<PickerItem[]>(() => {
        const found = new Set<string>();
        for (const session of sessions ?? []) if (typeof session !== 'string' && session.metadata?.machineId === selectedMachineId && session.metadata.path) found.add(session.metadata.path);
        return [...found].sort().map(path => ({ key: path, label: formatPathRelativeToHome(path, machine?.metadata?.homeDir) }));
    }, [sessions, selectedMachineId, machine?.metadata?.homeDir]);
    const directory = paths[selectedMachineId] ?? projectItems[0]?.label ?? '';
    const machineItems: PickerItem[] = [...machines].sort((a, b) => Number(b.active) - Number(a.active)).map(item => ({
        key: item.id, label: item.metadata?.displayName || item.metadata?.host || 'Unnamed machine',
        subtitle: !item.active ? `Offline · last seen ${formatLastSeen(item.activeAt, false)}` : workflow && workflowMachineIssue(workflow, item) ? 'Talos update needed' : 'Online',
        dimmed: !item.active,
    }));
    const machineName = machine?.metadata?.displayName || machine?.metadata?.host || 'Choose a machine';
    const machineIssue = workflow ? workflowMachineIssue(workflow, machine) : null;
    const locked = busy || !!receipt;
    const finishStart = (request: PendingWorkflowStart, outcome: 'created' | 'absent') => settleWorkflowStart(request, outcome, {
        read: loadPendingWorkflowStart,
        save: savePendingWorkflowStart,
        cleared: () => {
            if (sameWorkflowStart(pending.current, request)) pending.current = null;
            if (mounted.current) setReceipt(current => sameWorkflowStart(current, request) ? null : current);
        },
        focused: () => mounted.current && focusedRef.current,
        open: original => {
            // A session-list refresh failing must not turn a successful start into a failed start.
            void sync.refreshSessions().catch(() => {});
            router.replace(`/workflows/${original.id}?machineId=${encodeURIComponent(original.machineId)}` as any);
        },
    });
    const checkStart = async () => {
        if (inFlight.current) return;
        const request = loadPendingWorkflowStart();
        setReceipt(request);
        if (!sameWorkflowStart(pending.current, request)) pending.current = null;
        if (!request) { setNotice('No start request is waiting. You can start a new workflow.'); return; }
        inFlight.current = true; setBusy(true); setError(''); setNotice('');
        try {
            const state = await inspectWorkflowStart(request, workflowRPC);
            if (state === 'created') finishStart(request, 'created');
            else if (state === 'absent' && finishStart(request, 'absent')) setNotice('No workflow was started. You can update the details and try again.');
            else setNotice('Your machine is still preparing the workflow. Check again in a moment.');
        } catch (failure) { setError(workflowErrorMessage(failure, 'We could not confirm whether the workflow started. Keep this request and check again when the machine is online.')); }
        finally { inFlight.current = false; if (mounted.current) setBusy(false); }
    };
    const start = async () => {
        if (inFlight.current) return;
        setError(''); setNotice('');
        if (!workflow || !machine) return;
        if (!workflowEnabled(storage.getState().settings)) { setError('Enable Workflows in Settings → Features before starting.'); return; }
        // Read persisted state immediately before sending, including requests made on another mounted screen.
        const unresolved = loadPendingWorkflowStart();
        if (unresolved) { setReceipt(unresolved); setError('Check the earlier start request before starting another workflow.'); return; }
        let request: WorkflowStartRequest;
        try { request = prepareWorkflowStart({ id: randomUUID(), definition: workflow, task, directory, machine }); }
        catch (failure) { setError(failure instanceof Error ? failure.message : 'Check the task, machine, and project.'); if (!task.trim()) prompt.current?.focus(); return; }
        Keyboard.dismiss(); setPicker(null); inFlight.current = true; setBusy(true);
        let sent = false;
        try {
            // Persist before dispatch. If device storage fails, no start request is sent.
            savePendingWorkflowStart(request);
            pending.current = request; setReceipt({ id: request.id, machineId: request.machineId });
            sent = true;
            const run = await workflowRPC<{ id: string }>(request.machineId, workflowStartMethod(request.definition), request);
            if (!run || typeof run.id !== 'string' || run.id !== request.id) throw new Error('The machine returned an unknown start result.');
            finishStart(request, 'created');
        } catch (failure) {
            if (!sent) {
                pending.current = null;
                if (mounted.current) setError('Talos could not save this start request on your device. Reload the app and try again. No workflow was started.');
                return;
            }
            // A rejected preparation can safely unlock after an explicit absent receipt. A lost response cannot.
            try {
                const state = await inspectWorkflowStart(request, workflowRPC);
                if (state === 'created') { finishStart(request, 'created'); return; }
                if (state === 'absent') finishStart(request, 'absent');
            } catch { /* Keep the receipt until its original machine confirms the outcome. */ }
            if (mounted.current) setError(workflowErrorMessage(failure, pending.current ? 'We could not confirm the start. Use Check start status before trying again.' : 'The workflow could not start. Review its configuration and try again.'));
        } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
    };
    const closePicker = () => { Keyboard.dismiss(); setPicker(null); };
    const openPicker = (value: 'machine' | 'project') => { Keyboard.dismiss(); setPicker(value); setError(''); };
    const frozenWorkflow: WorkflowDefinition | undefined = pending.current?.definition ?? (receipt ? undefined : workflow);
    const stages = frozenWorkflow?.steps?.map(step => step.name) ?? ['Plan', 'Execute', 'Review'];
    const receiptMachine = machines.find(item => item.id === receipt?.machineId);
    const footer = receipt ? <WorkflowButton primary label={busy ? 'Checking your machine…' : 'Check start status'} disabled={busy} onPress={() => void checkStart()} />
        : workflow && enabled ? <WorkflowButton primary label={busy ? 'Starting workflow…' : 'Start workflow'} disabled={busy || !!machineIssue} onPress={() => void start()} /> : undefined;

    return <WorkflowScaffold footer={footer} scrollRef={scroll}>
        <WorkflowPageHeading eyebrow="RUN WORKFLOW" title={frozenWorkflow?.name ?? (receipt ? 'Check your workflow' : 'Workflow unavailable')} description={frozenWorkflow ? 'Give your team a task and choose where to work.' : undefined} />
        {receipt && <WorkflowNotice title={busy ? 'Preparing your workflow' : 'Confirm the earlier start'} message={`This request belongs to ${receiptMachine?.metadata?.displayName || receiptMachine?.metadata?.host || 'its original machine'}. This prevents starting the same task twice. You can return to Workflows while it connects.`} />}
        {!!error && <WorkflowNotice title="Needs your attention" message={error} />}
        {!!notice && <WorkflowNotice title="Start status" message={notice} />}
        {!workflow && !receipt && <WorkflowNotice title="Choose a saved workflow" message="This workflow may have been removed on another device. Return to Workflows and choose one from your library." action="Open Workflows" onAction={() => router.replace('/workflows' as any)} />}
        {!enabled && <WorkflowNotice title="Workflows are experimental" message="Enable Experimental Features and Workflows to start a new run. Existing runs continue on their machines." action="Open Features" onAction={() => router.push('/settings/features')} />}
        {frozenWorkflow && <>
            <View style={{ gap: 10, paddingBottom: 6 }}>
                <Text style={s.muted}>{stages.join('  →  ')}</Text>
                {!!frozenWorkflow.description && <Text style={s.muted}>{frozenWorkflow.description}</Text>}
            </View>
            <View style={{ gap: 10 }}>
                <Text style={{ ...s.text, fontWeight: '600' }}>What should your team do?</Text>
                <TextInput ref={prompt} accessibilityLabel="Workflow task" placeholder="Describe the outcome you want…" placeholderTextColor={s.colors.textSecondary}
                    value={pending.current?.task ?? task} onChangeText={setTask} editable={!locked && enabled} multiline maxLength={24000} textAlignVertical="top"
                    style={{ ...s.text, minHeight: 132, maxHeight: 220, borderRadius: 16, borderColor: s.colors.divider, borderWidth: 1, padding: 16, backgroundColor: s.colors.surface }} />
            </View>
            <View style={{ ...s.card, padding: 0, overflow: 'hidden', gap: 0 }}>
                <DestinationRow icon="desktop-outline" label="Machine" value={machineName} disabled={locked || !enabled} onPress={() => openPicker('machine')} />
                <View style={{ height: 1, backgroundColor: s.colors.divider, marginHorizontal: 18 }} />
                <DestinationRow icon="folder-open-outline" label="Project" value={pending.current?.directory ?? (directory || 'Choose a project folder')} disabled={locked || !enabled || !machine} onPress={() => openPicker('project')} />
            </View>
            {machineIssue && !receipt && <WorkflowNotice title={!machine ? 'Connect a machine' : !machine.active ? 'Machine offline' : 'Talos update needed'} message={machineIssue} action={machines.length ? 'Choose machine' : 'Connect machine'} onAction={() => machines.length ? openPicker('machine') : router.push('/terminal/connect')} />}
            <View style={{ flexDirection: 'row', gap: 10 }}>
                <Ionicons name="git-branch-outline" size={18} color={s.colors.textSecondary} style={{ marginTop: 2 }} />
                <Text style={{ ...s.muted, flex: 1 }}>Your team works in a separate Git worktree. Choose a Git project with committed changes. {frozenWorkflow.approvePlan ? 'You’ll approve the agreed plan before execution.' : 'Execution starts after the planners agree.'}</Text>
            </View>
        </>}
        <BaseModal visible={!!picker} onClose={closePicker}>
            <View style={{ width: Math.min(window.width - 24, 520), maxHeight: Math.max(220, Math.min(580, window.height - keyboardHeight - 100)), borderRadius: 22, overflow: 'hidden', backgroundColor: s.colors.surface, paddingTop: 8 }}>
                <View style={{ flexShrink: 1, minHeight: 0 }}>
                    {picker === 'machine' ? <PickerContent title="Choose machine" items={machineItems} selectedKey={selectedMachineId || null} searchPlaceholder="Search machines" onSelect={id => { setMachineId(id); setError(''); closePicker(); }} />
                        : picker === 'project' ? <PathPickerContent title="Choose project" items={projectItems} value={directory} homeDir={machine?.metadata?.homeDir} onChangeValue={value => setPaths(current => ({ ...current, [selectedMachineId]: value }))} onDone={closePicker} /> : null}
                </View>
                <View style={{ padding: 16, borderTopWidth: 1, borderColor: s.colors.divider }}><WorkflowButton label={picker === 'project' ? 'Use this project' : 'Close machine picker'} primary={picker === 'project'} onPress={closePicker} /></View>
            </View>
        </BaseModal>
    </WorkflowScaffold>;
}

function DestinationRow({ icon, label, value, disabled, onPress }: { icon: 'desktop-outline' | 'folder-open-outline'; label: string; value: string; disabled: boolean; onPress: () => void }) {
    const s = useWorkflowStyles();
    return <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
        style={({ pressed }) => ({ minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, opacity: disabled ? 0.55 : 1, backgroundColor: pressed ? s.colors.divider : 'transparent' })}>
        <Ionicons name={icon} size={22} color={s.colors.textSecondary} />
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text style={{ ...s.muted, fontSize: 12 }}>{label}</Text><Text style={{ ...s.text, fontWeight: '600' }} numberOfLines={2}>{value}</Text></View>
        <Ionicons name="chevron-forward" size={17} color={s.colors.textSecondary} />
    </Pressable>;
}
