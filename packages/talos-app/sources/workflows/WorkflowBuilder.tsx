import { AgentRuntimePicker } from '@/agents/AgentRuntimePicker';
import React from 'react';
import { Text, View, Modal as NativeModal, Pressable, Keyboard, Platform, Switch, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WorkflowScaffold } from './WorkflowScaffold';
import { agentDraftProblem, workflowSaveMessage, type WorkflowBuilderSection } from './wizard';
import { Typography } from '@/constants/Typography';
import { WorkflowAgentSchema, workflowSlots, type WorkflowDefinition, type WorkflowStep } from '@ahmadposten/talos-wire';
import { randomUUID } from 'expo-crypto';
import { AgentDefinitionSchema, agentLaunchError, agentProviders, type AgentDefinition } from '@/agents/agentDefinition';
import type { Machine } from '@/sync/storageTypes';
import { isMachineOnline } from '@/utils/machineUtils';
import { useMachineModelCatalog } from '@/hooks/useMachineModelCatalog';
import { WorkflowButton as Button, WorkflowInput as Input, WorkflowPickerContext, WorkflowSelectionList, WorkflowAvatar, WorkflowSectionHeader, type WorkflowSelection, useWorkflowStyles } from './ui';
import { attachWorkflowAgent, builderAgent, newWorkflowStep, stepLabels, withSteps } from './builder';

export function WorkflowBuilder({ draft, onChange, candidates, onCandidates, agents, machine, machines, onMachine, onReveal, section }: {
    draft: WorkflowDefinition; onChange: (draft: WorkflowDefinition) => void;
    candidates: AgentDefinition[]; onCandidates: (agents: AgentDefinition[]) => void; agents: AgentDefinition[];
    machine: Machine | undefined; machines: Machine[]; onMachine: (id: string) => void; onReveal: (node: View | null) => void; section: WorkflowBuilderSection;
}) {
    const s = useWorkflowStyles(), steps = draft.steps!;
    const window = useWindowDimensions(), insets = useSafeAreaInsets();
    const [selection, setSelection] = React.useState<WorkflowSelection | null>(null);
    const [references, setReferences] = React.useState(false);
    const [machinePicker, setMachinePicker] = React.useState(false);
    const stepViews = React.useRef(new Map<string, View>());
    const [expanded, setExpanded] = React.useState<string | null>(null);
    const [addingStep, setAddingStep] = React.useState(false), [rules, setRules] = React.useState(false);
    const [error, setError] = React.useState('');
    const [limitValues, setLimitValues] = React.useState({ planningRounds: String(draft.planningRounds), reviewRounds: String(draft.reviewRounds), turnMinutes: String(draft.turnMinutes), maxTurns: String(draft.maxTurns) });
    const [picker, setPicker] = React.useState<{ stepId: string; replacing?: number } | null>(null);
    const [editing, setEditingState] = React.useState<AgentDefinition | null>(null);
    const setEditing = (value: AgentDefinition | null) => { setError(''); setEditingState(value); };
    const catalog = useMachineModelCatalog(machine && isMachineOnline(machine) ? machine.id : null, editing?.provider ?? 'codex');
    const selectedStep = steps.find(step => step.id === picker?.stepId);
    const library = [...agents, ...candidates];
    // React Native Web uses thumbColor for the off state and a separate color for the on state.
    const webSwitchProps = Platform.OS === 'web' ? { activeThumbColor: s.colors.switch.thumb.active } : {};
    const patch = (value: Partial<WorkflowDefinition>) => onChange({ ...draft, ...value });
    const patchStep = (id: string, value: Partial<WorkflowStep>) => onChange(withSteps(draft, steps.map(step => step.id === id ? { ...step, ...value } : step)));
    const move = (index: number, direction: number) => { const next = [...steps]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; onChange(withSteps(draft, next)); };
    const closeAgent = () => {
        Keyboard.dismiss(); setSelection(null); setReferences(false);
        const stepId = picker?.stepId;
        if (stepId) requestAnimationFrame(() => requestAnimationFrame(() => onReveal(stepViews.current.get(stepId) ?? null)));
        setPicker(null); setEditing(null); setError(''); };
    const selectAgent = (agent: AgentDefinition) => {
        if (!picker || !selectedStep) return;
        if (selectedStep.agents.some((slot, i) => i !== picker.replacing && slot.agent.id === agent.id)) { setError('This agent already participates in this step.'); return; }
        if (selectedStep.kind === 'execute' && agent.permissionMode === 'read-only') { setError('Choose an executor that allows workspace edits.'); return; }
        const writers = steps.filter(step => step.kind === 'execute').flatMap(step => step.agents.map(slot => slot.agent.id));
        const reviewers = steps.filter(step => step.kind === 'review').flatMap(step => step.agents.map(slot => slot.agent.id));
        if (selectedStep.kind === 'review' && writers.includes(agent.id) || selectedStep.kind === 'execute' && reviewers.includes(agent.id)) { setError('Reviewers must be independent of every executor.'); return; }
        onChange(attachWorkflowAgent(draft, picker.stepId, WorkflowAgentSchema.parse(agent), picker.replacing)); closeAgent();
    };
    const saveAgent = () => {
        if (!editing || !picker || !selectedStep) return;
        try {
            const inputProblem = agentDraftProblem(editing);
            if (inputProblem) { setError(inputProblem); return; }
            const agent = AgentDefinitionSchema.parse({ ...editing, modelLabel: catalog.models.find(m => m.code === editing.model)?.value });
            const problem = agentLaunchError(agent, catalog.status === 'ready' ? catalog.models : null); if (problem) throw new Error(problem);
            // Candidate edits update all references to this identity; saved library agents are forked before editing.
            const updated = withSteps(draft, steps.map(step => ({ ...step, agents: step.agents.map(slot => slot.agent.id === agent.id ? { ...slot, agent: WorkflowAgentSchema.parse(agent) } : slot) })));
            const next = attachWorkflowAgent(updated, picker.stepId, WorkflowAgentSchema.parse(agent), picker.replacing);
            if (selectedStep.agents.some((slot, i) => i !== picker.replacing && slot.agent.id === agent.id)) throw new Error('This agent already participates in this step.');
            onCandidates([...candidates.filter(a => a.id !== agent.id), agent]); onChange(next); closeAgent();
        } catch (e) { setError(e instanceof Error && !('issues' in e) ? e.message : workflowSaveMessage(e)); }
    };
    const startAgent = () => {
        if (!selectedStep) return;
        const model = catalog.models.find(m => m.isDefault) ?? catalog.models[0];
        const base = selectedStep.kind === 'plan' ? 'Planner' : selectedStep.kind === 'execute' ? 'Builder' : 'Reviewer';
        let count = 1; while (library.some(a => a.name === `${base} ${count}`)) count++;
        setEditing(builderAgent(`${base} ${count}`, selectedStep.kind, model?.code ?? '', model?.defaultReasoningEffort ?? null)); setError('');
    };
    const editAgent = (step: WorkflowStep, index: number) => {
        const slot = step.agents[index], saved = library.find(a => a.id === slot.agent.id);
        const candidate = candidates.some(a => a.id === slot.agent.id);
        setPicker({ stepId: step.id, replacing: index });
        setEditing({ ...builderAgent(slot.agent.name, step.kind, slot.agent.model, slot.agent.effort), ...saved, ...slot.agent,
            id: candidate ? slot.agent.id : randomUUID(), name: candidate ? slot.agent.name : `${slot.agent.name.slice(0, 49)} (workflow)` });
        setError('');
    };
    const editor = picker && selectedStep && <NativeModal visible transparent animationType="slide" onRequestClose={closeAgent}>
        <View style={{ flex: 1, backgroundColor: '#00000080', alignItems: 'center', justifyContent: 'center', paddingTop: Math.max(12, insets.top), paddingBottom: Math.max(12, insets.bottom), paddingHorizontal: 12 }}>
        <View style={{ width: Math.min(window.width - 24, 580), flex: 1, maxHeight: 860, backgroundColor: s.colors.surface, borderRadius: 24, overflow: 'hidden' }}
            {...(Platform.OS === 'web' ? { onClick: (event: { stopPropagation: () => void }) => event.stopPropagation(), onPointerDown: (event: { stopPropagation: () => void }) => event.stopPropagation() } : {})}>
        {selection ? <WorkflowSelectionList selection={selection} onClose={() => setSelection(null)} /> : <>
        <View style={{ padding: 20, borderBottomWidth: 1, borderColor: s.colors.divider, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1 }}><Text style={{ ...s.muted, fontSize: 12 }}>{selectedStep.name}</Text><Text accessibilityRole="header" style={{ ...s.text, ...Typography.header(), fontSize: 23 }}>{editing ? 'Configure agent' : 'Choose an agent'}</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel agent" onPress={closeAgent} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="close" size={24} color={s.colors.textSecondary} /></Pressable>
        </View>
        <WorkflowScaffold footer={editing || error ? <>
            {error !== '' && <Text accessibilityRole="alert" style={{ ...s.muted, color: s.colors.warning }}>{error}</Text>}
            {editing && <><Button primary label="Use this agent" disabled={catalog.status !== 'ready'} onPress={saveAgent} /><Text style={{ ...s.muted, fontSize: 12, textAlign: 'center' }}>Saved to your library with this workflow.</Text></>}
        </> : undefined}>
        <WorkflowPickerContext.Provider value={setSelection}>
        {editing ? <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <WorkflowAvatar name={editing.name} provider={editing.provider} size={48} />
                <View style={{ flex: 1, gap: 3 }}><Text style={{ ...s.text, ...Typography.header(), fontSize: 18 }}>{editing.name || 'Your agent'}</Text><Text style={s.muted}>{selectedStep.kind === 'execute' ? 'Builds in the project worktree' : 'Independent, read-only participation'}</Text></View>
            </View>
            <Input label="Agent name" value={editing.name} placeholder="Give this agent a name" max={60} onChange={name => setEditing({ ...editing, name })} />
            <Input label="Agent description" value={editing.description} placeholder="What does this agent bring to the team?" max={300} onChange={description => setEditing({ ...editing, description })} />
            <View style={{ gap: 8 }}><WorkflowSectionHeader title="Intelligence" /><AgentRuntimePicker catalog={catalog} agent={editing} machineId={machine && isMachineOnline(machine) ? machine.id : null} onChange={value => { setError(''); setEditing({ ...editing, ...value }); }} /></View>
            <Input label="Agent instructions" value={editing.instructions} multiline onChange={instructions => setEditing({ ...editing, instructions })} />
            <Button variant="ghost" icon={references ? 'chevron-up' : 'document-text-outline'} label={`Reference files · ${editing.documents.length}/5 ${references ? '−' : '+'}`} onPress={() => setReferences(!references)} />
            {references && editing.documents.map((document, index) => <View key={index} style={{ borderTopWidth: 1, borderColor: s.colors.divider, paddingTop: 18, gap: 16 }}>
                <Input label={`Reference ${index + 1} filename`} value={document.name} max={120} onChange={name => setEditing({ ...editing, documents: editing.documents.map((d, i) => i === index ? { ...d, name } : d) })} />
                <Input label={`Reference ${index + 1} Markdown`} value={document.content} max={16000} multiline mono onChange={content => setEditing({ ...editing, documents: editing.documents.map((d, i) => i === index ? { ...d, content } : d) })} />
                <Button variant="danger" compact icon="trash-outline" label={`Remove reference ${index + 1}`} onPress={() => setEditing({ ...editing, documents: editing.documents.filter((_, i) => i !== index) })} />
            </View>)}
            {references && editing.documents.length < 5 && <Button variant="ghost" icon="add" label="Add reference file" onPress={() => setEditing({ ...editing, documents: [...editing.documents, { name: 'instructions.md', content: '' }] })} />}
        </> : <>
            <Button icon="add" label="Create new agent" disabled={!machine || !isMachineOnline(machine)} onPress={startAgent} />
            {(!machine || !isMachineOnline(machine)) && <Text style={s.muted}>Choose an online machine in the Team step to configure a new agent.</Text>}
            <WorkflowSectionHeader title={library.length ? 'From your library' : 'A new identity for your team'} />
            {!library.length && <Text style={s.muted}>Create an agent with its own instructions, provider, and model. You can reuse it in future workflows.</Text>}
            <View>{library.map(agent => {
                const used = selectedStep.agents.some((slot, i) => i !== picker.replacing && slot.agent.id === agent.id);
                return <Pressable key={agent.id} accessibilityRole="button" accessibilityLabel={`Add ${agent.name}`} accessibilityState={{ disabled: used }} disabled={used} onPress={() => selectAgent(agent)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderColor: s.colors.divider, opacity: used ? 0.45 : 1, backgroundColor: pressed ? s.colors.surfacePressed : 'transparent' })}>
                    <WorkflowAvatar name={agent.name} provider={agent.provider} size={40} />
                    <View style={{ flex: 1, gap: 3 }}><Text style={{ ...s.text, ...Typography.header() }}>{agent.name}</Text><Text numberOfLines={2} style={{ ...s.muted, fontSize: 13 }}>{agent.description}</Text><Text style={{ ...s.muted, fontSize: 11 }}>{agentProviders.find(provider => provider.code === agent.provider)?.name}{used ? ' · Already in this stage' : ''}</Text></View>
                    <Ionicons name={used ? 'checkmark' : 'add'} size={20} color={used ? s.colors.textSecondary : s.colors.accent} />
                </Pressable>;
            })}</View>
        </>}
        </WorkflowPickerContext.Provider>
        </WorkflowScaffold>
        </>}
        </View>
        </View>
    </NativeModal>;
    const icons = { plan: 'compass-outline', execute: 'code-slash-outline', review: 'checkmark-done-outline' } as const;
    const roleName = (kind: WorkflowStep['kind']) => kind === 'plan' ? 'planner' : kind === 'execute' ? 'executor' : 'reviewer';
    const machineName = machine?.metadata?.displayName || machine?.metadata?.host || 'Choose a machine';
    const machineSelection: WorkflowSelection = { title: 'Choose machine for models', value: machine?.id ?? '', options: machines.map(item => ({ value: item.id, label: item.metadata?.displayName || item.metadata?.host || item.id, description: isMachineOnline(item) ? 'Online · live providers and models' : 'Offline' })), onSelect: onMachine };
    return <View style={{ gap: 24 }}>
        {editor}
        {machinePicker && <NativeModal visible transparent animationType="fade" onRequestClose={() => setMachinePicker(false)}><View style={{ flex: 1, backgroundColor: '#00000080', alignItems: 'center', justifyContent: 'center', padding: 16 }}><View style={{ width: Math.min(window.width - 32, 520), height: Math.min(window.height - insets.top - insets.bottom - 48, 520), backgroundColor: s.colors.surface, borderRadius: 24, overflow: 'hidden' }}><WorkflowSelectionList selection={machineSelection} onClose={() => setMachinePicker(false)} /></View></View></NativeModal>}
        {section === 'basics' && <View style={{ gap: 26 }}>
            <Input label="Workflow name" value={draft.name} placeholder="e.g. Feature studio" max={80} onChange={name => patch({ name })} />
            <Input label="Description (optional)" value={draft.description} placeholder="What kind of work is this team made for?" multiline max={1000} onChange={description => patch({ description })} />
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingTop: 4 }}><Ionicons name="repeat-outline" size={19} color={s.colors.accent} /><Text style={{ ...s.muted, flex: 1, fontSize: 13 }}>Save the team once. Give it a fresh task and project each time you run it.</Text></View>
        </View>}
        {section === 'team' && <>
            <Pressable accessibilityRole="button" accessibilityLabel={`Models from: ${machineName}`} onPress={() => { Keyboard.dismiss(); setMachinePicker(true); }} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingVertical: 8, backgroundColor: pressed ? s.colors.surfacePressed : 'transparent' })}>
                <Ionicons name="desktop-outline" size={18} color={s.colors.textSecondary} /><Text style={{ ...s.muted, fontSize: 12 }}>Models from</Text><Text numberOfLines={1} style={{ ...s.text, ...Typography.default('semiBold'), fontSize: 13, flex: 1 }}>{machineName}</Text><Ionicons name="chevron-down" size={15} color={s.colors.textSecondary} />
            </Pressable>
            {!machines.length && <Text style={s.muted}>Connect a machine to configure new agents, or choose agents already in your library.</Text>}
            {machine && !isMachineOnline(machine) && <Text style={s.muted}>This machine is offline. Choose an online machine for new agents, or use saved agents.</Text>}
            {machine && (machine.metadata?.workflows?.version ?? 0) < 3 && workflowSlots(draft).some(slot => slot.agent.provider !== 'codex') && <Text style={s.muted}>Update Talos on this machine before running a workflow with multiple providers.</Text>}
            {machine && (machine.metadata?.workflows?.version ?? 0) < 2 && <Text style={s.muted}>You can design now. Update this machine’s Talos CLI before running editable stages.</Text>}
            <View>{steps.map((step, index) => <View key={step.id} ref={node => { if (node) stepViews.current.set(step.id, node); else stepViews.current.delete(step.id); }} collapsable={false} style={{ flexDirection: 'row', gap: 14 }}>
                <View style={{ width: 34, alignItems: 'center' }}><View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: s.colors.accentSoft, alignItems: 'center', justifyContent: 'center', marginTop: 4 }}><Ionicons name={icons[step.kind]} size={18} color={s.colors.accent} /></View>{index < steps.length - 1 && <View style={{ width: 1, flex: 1, backgroundColor: s.colors.divider, marginTop: 10, marginBottom: 10, minHeight: 16 }} />}</View>
                <View style={{ flex: 1, minWidth: 0, paddingBottom: index === steps.length - 1 ? 0 : 24, gap: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><View style={{ flex: 1, gap: 2 }}><Text style={{ ...s.text, ...Typography.header(), fontSize: 18 }}>{step.name}</Text><Text style={{ ...s.muted, fontSize: 11, lineHeight: 16 }}>{step.kind === 'execute' ? 'Workspace edits' : 'Unanimous approval'} · {step.agents.length}/{step.kind === 'execute' ? 1 : 3} {roleName(step.kind)}{step.kind === 'execute' ? '' : 's'}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={`${expanded === step.id ? 'Hide' : 'Customize'} step ${index + 1}`} onPress={() => setExpanded(expanded === step.id ? null : step.id)} style={{ minHeight: 44, width: 44, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={expanded === step.id ? 'close' : 'options-outline'} size={19} color={expanded === step.id ? s.colors.accent : s.colors.textSecondary} /></Pressable></View>
                    {!!step.agents.length && <View style={{ gap: 4 }}>{step.agents.map((slot, slotIndex) => <View key={`${slot.agent.id}-${slotIndex}`} style={{ gap: 12 }}>
                        <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${slot.agent.name} in step ${index + 1}`} onPress={() => editAgent(step, slotIndex)} style={({ pressed }) => ({ minHeight: 58, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: pressed ? s.colors.surfacePressed : s.colors.surface })}>
                            <WorkflowAvatar name={slot.agent.name} provider={slot.agent.provider} size={30} /><View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={{ ...s.text, ...Typography.header(), fontSize: 14 }}>{slot.agent.name}</Text><Text numberOfLines={1} style={{ ...s.muted, fontSize: 11, lineHeight: 17 }}>{agentProviders.find(provider => provider.code === slot.agent.provider)?.name} · {slot.agent.modelLabel || (slot.agent.model === 'default' ? 'Provider default' : slot.agent.model)}{slot.agent.effort ? ` · ${slot.agent.effort}` : ''}</Text></View><Ionicons name="chevron-forward" size={14} color={s.colors.textSecondary} />
                        </Pressable>
                        {expanded === step.id && <View style={{ gap: 12, paddingBottom: 12 }}><Input label={`${slot.agent.name} assignment in step ${index + 1}`} value={slot.assignment} multiline onChange={assignment => patchStep(step.id, { agents: step.agents.map((agent, i) => i === slotIndex ? { ...agent, assignment } : agent) })} /><View style={s.row}><Button compact variant="ghost" icon="swap-horizontal" label="Replace" accessibilityLabel={`Replace ${slot.agent.name} in step ${index + 1}`} onPress={() => { setPicker({ stepId: step.id, replacing: slotIndex }); setEditing(null); setError(''); }} /><Button compact variant="danger" icon="remove" label="Remove" accessibilityLabel={`Remove ${slot.agent.name} from step ${index + 1}`} onPress={() => { closeAgent(); patchStep(step.id, { agents: step.agents.filter((_, i) => i !== slotIndex) }); }} /></View></View>}
                    </View>)}</View>}
                    {step.agents.length < (step.kind === 'execute' ? 1 : 3) && <View style={{ alignSelf: 'flex-start' }}><Button variant="ghost" compact icon="add" label={`Add ${roleName(step.kind)}`} accessibilityLabel={`Add ${roleName(step.kind)} to step ${index + 1}`} onPress={() => { setPicker({ stepId: step.id }); setEditing(null); setError(''); }} /></View>}
                    {expanded === step.id && <View style={{ gap: 18, paddingTop: 12, borderTopWidth: 1, borderColor: s.colors.divider }}>
                        <View style={s.row}><Button compact variant="ghost" icon="arrow-up" label="Up" accessibilityLabel={`Move step ${index + 1} up`} disabled={index === 0 || !!picker} onPress={() => move(index, -1)} /><Button compact variant="ghost" icon="arrow-down" label="Down" accessibilityLabel={`Move step ${index + 1} down`} disabled={index === steps.length - 1 || !!picker} onPress={() => move(index, 1)} /><Button compact variant="danger" icon="trash-outline" label="Delete" accessibilityLabel={`Remove step ${index + 1}`} disabled={!!picker} onPress={() => onChange(withSteps(draft, steps.filter(item => item.id !== step.id)))} /></View>
                        <Input label={`Step ${index + 1} name`} value={step.name} max={80} onChange={name => patchStep(step.id, { name })} />
                        <Input label={`Step ${index + 1} criteria`} value={step.criteria} multiline onChange={criteria => patchStep(step.id, { criteria })} />
                        {step.kind === 'review' && <>
                            <Text style={s.muted}>Optional checks for this review. Failed checks return work to the preceding executor.</Text>
                            {step.checks.map((check, i) => <View key={i} style={{ gap: 12 }}><Input label={`Step ${index + 1} check ${i + 1} name`} max={100} value={check.name} onChange={name => patchStep(step.id, { checks: step.checks.map((item, j) => j === i ? { ...item, name } : item) })} /><Input label={`Step ${index + 1} check ${i + 1} command`} mono max={2000} value={check.command} onChange={command => patchStep(step.id, { checks: step.checks.map((item, j) => j === i ? { ...item, command } : item) })} /><Button compact variant="danger" label={`Remove step ${index + 1} check ${i + 1}`} onPress={() => patchStep(step.id, { checks: step.checks.filter((_, j) => j !== i) })} /></View>)}
                            {step.checks.length < 8 && <Button variant="ghost" compact icon="add" label={`Add check to step ${index + 1}`} onPress={() => patchStep(step.id, { checks: [...step.checks, { name: '', command: '' }] })} />}
                        </>}
                    </View>}
                </View>
            </View>)}</View>
            <Button variant="secondary" icon={addingStep ? 'close' : 'add'} label="Add step" disabled={steps.length >= 8 || !!picker} onPress={() => setAddingStep(!addingStep)} />
            {addingStep && <View style={{ gap: 4 }}>{(['plan', 'execute', 'review'] as const).map(kind => <Pressable key={kind} accessibilityRole="button" accessibilityLabel={`Add ${stepLabels[kind].toLowerCase()} step`} onPress={() => { const step = newWorkflowStep(kind); onChange(withSteps(draft, [...steps, step])); setExpanded(step.id); setAddingStep(false); }} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 12, borderRadius: 12, backgroundColor: pressed ? s.colors.surfacePressed : 'transparent' })}><Ionicons name={icons[kind]} size={21} color={s.colors.accent} /><View style={{ flex: 1 }}><Text style={{ ...s.text, ...Typography.header(), fontSize: 15 }}>{stepLabels[kind]}</Text><Text style={{ ...s.muted, fontSize: 12 }}>{kind === 'plan' ? 'Agree on the approach' : kind === 'execute' ? 'Build and verify the work' : 'Independently check the result'}</Text></View><Ionicons name="add" size={18} color={s.colors.textSecondary} /></Pressable>)}</View>}
        </>}
        {section === 'finish' && <View style={{ gap: 30 }}>
            <Input label="Completion criteria" value={draft.criteria} placeholder="What must be true before this work is done?" multiline onChange={criteria => patch({ criteria })} />
            <View style={{ gap: 18 }}>
                <WorkflowSectionHeader title="Verification" />
                <Text style={{ ...s.muted, marginTop: -10 }}>Every command must pass before the workflow finishes.</Text>
                {draft.checks.map((check, index) => <View key={index} style={{ gap: 14, paddingBottom: 20, borderBottomWidth: 1, borderColor: s.colors.divider }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}><Text style={{ ...s.muted, ...Typography.default('semiBold'), fontSize: 11, letterSpacing: 1, flex: 1 }}>CHECK {String(index + 1).padStart(2, '0')}</Text>{draft.checks.length > 1 && <Pressable accessibilityRole="button" accessibilityLabel={`Remove check ${index + 1}`} onPress={() => patch({ checks: draft.checks.filter((_, i) => i !== index) })} style={{ minHeight: 44, width: 44, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="trash-outline" size={17} color={s.colors.textSecondary} /></Pressable>}</View>
                    <Input label={`Check ${index + 1} name`} value={check.name} placeholder="e.g. Test suite" max={100} onChange={name => patch({ checks: draft.checks.map((item, i) => i === index ? { ...item, name } : item) })} />
                    <Input label={`Check ${index + 1} command`} value={check.command} placeholder="pnpm test" mono max={2000} onChange={command => patch({ checks: draft.checks.map((item, i) => i === index ? { ...item, command } : item) })} />
                </View>)}
                {draft.checks.length < 8 && <Button variant="ghost" compact icon="add" label="Add completion check" onPress={() => patch({ checks: [...draft.checks, { name: '', command: '' }] })} />}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}><View style={{ flex: 1, gap: 5 }}><Text style={{ ...s.text, ...Typography.header() }}>Approve the plan myself</Text><Text style={{ ...s.muted, fontSize: 13 }}>Pause after consensus, before execution.</Text></View><Switch accessibilityLabel="Require my approval after planning consensus" value={draft.approvePlan} onValueChange={approvePlan => patch({ approvePlan })} trackColor={{ false: s.colors.divider, true: s.colors.accent }} thumbColor={s.colors.switch.thumb.active}
                {...webSwitchProps} /></View>
            <View style={{ gap: 18, borderTopWidth: 1, borderColor: s.colors.divider, paddingTop: 16 }}>
                <Pressable accessibilityRole="button" accessibilityLabel={rules ? 'Hide advanced limits' : 'Advanced limits'} onPress={() => setRules(!rules)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }}><View style={{ flex: 1, gap: 4 }}><Text style={{ ...s.text, ...Typography.header(), fontSize: 15 }}>Advanced limits</Text><Text style={{ ...s.muted, fontSize: 12 }}>{Number.isFinite(draft.maxTurns) ? draft.maxTurns : '—'} turns total · {Number.isFinite(draft.turnMinutes) ? draft.turnMinutes : '—'} min per turn</Text></View><Ionicons name={rules ? 'chevron-up' : 'chevron-down'} size={18} color={s.colors.textSecondary} /></Pressable>
                {rules && (['planningRounds', 'reviewRounds', 'turnMinutes', 'maxTurns'] as const).map((key, i) => <Input key={key} label={['Planning round limit (1–5)', 'Review round limit (1–5)', 'Minutes per agent turn (1–30)', 'Agent turn limit (8–100)'][i]} value={limitValues[key]} numeric max={3} onChange={value => { setLimitValues({ ...limitValues, [key]: value }); patch({ [key]: value.trim() ? Number(value) : NaN }); }} />)}
            </View>
        </View>}
    </View>;
}
