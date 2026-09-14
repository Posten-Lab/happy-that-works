import { AgentRuntimePicker } from '@/agents/AgentRuntimePicker';
import React from 'react';
import { Text, View, ScrollView, Pressable, Keyboard, Platform, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BaseModal } from '@/modal/components/BaseModal';
import { Typography } from '@/constants/Typography';
import { WorkflowDefinitionSchema, WorkflowAgentSchema, workflowSlots, type WorkflowDefinition, type WorkflowStep } from '@ahmadposten/talos-wire';
import { randomUUID } from 'expo-crypto';
import { AgentDefinitionSchema, agentLaunchError, agentProviders, type AgentDefinition } from '@/agents/agentDefinition';
import type { Machine } from '@/sync/storageTypes';
import { isMachineOnline } from '@/utils/machineUtils';
import { useMachineModelCatalog } from '@/hooks/useMachineModelCatalog';
import { WorkflowButton as Button, WorkflowInput as Input, WorkflowSelect, WorkflowPickerContext, WorkflowSelectionList, type WorkflowSelection, useWorkflowStyles } from './ui';
import { attachWorkflowAgent, builderAgent, newWorkflowStep, stepLabels, withSteps } from './builder';

export function WorkflowBuilder({ draft, onChange, candidates, onCandidates, agents, machine, machines, onMachine, onSave, onCancel, onReveal }: {
    draft: WorkflowDefinition; onChange: (draft: WorkflowDefinition) => void;
    candidates: AgentDefinition[]; onCandidates: (agents: AgentDefinition[]) => void; agents: AgentDefinition[];
    machine: Machine | undefined; machines: Machine[]; onMachine: (id: string) => void; onSave: () => void; onCancel: () => void; onReveal: (node: View | null) => void;
}) {
    const s = useWorkflowStyles(), steps = draft.steps!;
    const window = useWindowDimensions(), insets = useSafeAreaInsets();
    const [selection, setSelection] = React.useState<WorkflowSelection | null>(null);
    const [references, setReferences] = React.useState(false);
    const [keyboardHeight, setKeyboardHeight] = React.useState(0);
    React.useEffect(() => {
        const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', e => setKeyboardHeight(e.endCoordinates.height));
        const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardHeight(0));
        return () => { show.remove(); hide.remove(); };
    }, []);
    const stepViews = React.useRef(new Map<string, View>());
    const [expanded, setExpanded] = React.useState<string | null>(null);
    const [addingStep, setAddingStep] = React.useState(false), [rules, setRules] = React.useState(false);
    const [error, setError] = React.useState('');
    const [picker, setPicker] = React.useState<{ stepId: string; replacing?: number } | null>(null);
    const [editing, setEditing] = React.useState<AgentDefinition | null>(null);
    const catalog = useMachineModelCatalog(machine && isMachineOnline(machine) ? machine.id : null, editing?.provider ?? 'codex');
    const selectedStep = steps.find(step => step.id === picker?.stepId);
    const library = [...agents, ...candidates];
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
            const agent = AgentDefinitionSchema.parse({ ...editing, modelLabel: catalog.models.find(m => m.code === editing.model)?.value });
            const problem = agentLaunchError(agent, catalog.status === 'ready' ? catalog.models : null); if (problem) throw new Error(problem);
            // Candidate edits update all references to this identity; saved library agents are forked before editing.
            const updated = withSteps(draft, steps.map(step => ({ ...step, agents: step.agents.map(slot => slot.agent.id === agent.id ? { ...slot, agent: WorkflowAgentSchema.parse(agent) } : slot) })));
            const next = attachWorkflowAgent(updated, picker.stepId, WorkflowAgentSchema.parse(agent), picker.replacing);
            if (selectedStep.agents.some((slot, i) => i !== picker.replacing && slot.agent.id === agent.id)) throw new Error('This agent already participates in this step.');
            onCandidates([...candidates.filter(a => a.id !== agent.id), agent]); onChange(next); closeAgent();
        } catch (e) { setError(e instanceof Error ? e.message : 'Could not save agent.'); }
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
        setExpanded(step.id); setPicker({ stepId: step.id, replacing: index });
        setEditing({ ...builderAgent(slot.agent.name, step.kind, slot.agent.model, slot.agent.effort), ...saved, ...slot.agent,
            id: candidate ? slot.agent.id : randomUUID(), name: candidate ? slot.agent.name : `${slot.agent.name.slice(0, 49)} (workflow)` });
        setError('');
    };
    const editor = picker && selectedStep && <BaseModal visible onClose={closeAgent} closeOnBackdrop={false} animationType="slide">
        <View style={{ width: Math.min(window.width, 580), height: Math.max(240, window.height - insets.top - insets.bottom - keyboardHeight - 24), maxHeight: 860, backgroundColor: s.colors.surface, borderRadius: window.width > 600 ? 24 : 18, overflow: 'hidden' }}>
        {selection ? <WorkflowSelectionList selection={selection} onClose={() => setSelection(null)} /> : <>
        <View style={{ padding: 20, borderBottomWidth: 1, borderColor: s.colors.divider, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1 }}><Text style={{ ...s.muted, fontSize: 12 }}>{selectedStep.name}</Text><Text accessibilityRole="header" style={{ ...s.text, ...Typography.header(), fontSize: 23 }}>{editing ? 'Configure agent' : 'Choose an agent'}</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel agent" onPress={closeAgent} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="close" size={24} color={s.colors.textSecondary} /></Pressable>
        </View>
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ padding: 20, gap: 18 }}>
        <WorkflowPickerContext.Provider value={setSelection}>
        {editing ? <>
            <Text style={s.muted}>Give this agent an identity and choose how it works.</Text>
            <Input label="Agent name" value={editing.name} max={60} onChange={name => setEditing({ ...editing, name })} />
            <AgentRuntimePicker catalog={catalog} agent={editing} machineId={machine && isMachineOnline(machine) ? machine.id : null} onChange={value => { setError(''); setEditing({ ...editing, ...value }); }} />
            <Input label="Agent description" value={editing.description} max={300} onChange={description => setEditing({ ...editing, description })} />
            <Text style={s.muted}>{selectedStep.kind === 'execute' ? 'Can edit files in the isolated worktree.' : 'Runs read-only in this step.'}</Text>
            <Input label="Agent instructions" value={editing.instructions} multiline onChange={instructions => setEditing({ ...editing, instructions })} />
            <Button label={`Reference files · ${editing.documents.length}/5 ${references ? '−' : '+'}`} onPress={() => setReferences(!references)} />
            {references && editing.documents.map((document, index) => <View key={index} style={s.card}>
                <Input label={`Reference ${index + 1} filename`} value={document.name} max={120} onChange={name => setEditing({ ...editing, documents: editing.documents.map((d, i) => i === index ? { ...d, name } : d) })} />
                <Input label={`Reference ${index + 1} Markdown`} value={document.content} max={16000} multiline onChange={content => setEditing({ ...editing, documents: editing.documents.map((d, i) => i === index ? { ...d, content } : d) })} />
                <Button label={`Remove reference ${index + 1}`} onPress={() => setEditing({ ...editing, documents: editing.documents.filter((_, i) => i !== index) })} />
            </View>)}
            {references && editing.documents.length < 5 && <Button label="Add reference file" onPress={() => setEditing({ ...editing, documents: [...editing.documents, { name: 'instructions.md', content: '' }] })} />}
        </> : <>
            <Button primary label="Create new agent" onPress={startAgent} />
            <Text style={s.muted}>{library.length ? 'Or choose an agent from your library' : 'Your library is empty. Create an agent here to get started.'}</Text>
            {library.map(agent => <Button key={agent.id} label={`Add ${agent.name}`} disabled={selectedStep.agents.some((slot, i) => i !== picker.replacing && slot.agent.id === agent.id)} onPress={() => selectAgent(agent)} />)}
        </>}
        </WorkflowPickerContext.Provider>
        </ScrollView>
        {error !== '' && <Text accessibilityRole="alert" style={{ ...s.muted, color: s.colors.warning, paddingHorizontal: 16, paddingVertical: 8 }}>{error}</Text>}
        {editing && <View style={{ padding: 16, borderTopWidth: 1, borderColor: s.colors.divider, gap: 8 }}><Button primary label="Use this agent" disabled={catalog.status !== 'ready'} onPress={saveAgent} /><Text style={{ ...s.muted, fontSize: 12, textAlign: 'center' }}>Saved to your library with this workflow.</Text></View>}
        </>}
        </View>
    </BaseModal>;
    return <View style={{ gap: 20 }}>
        {editor}
        <View style={s.card}>
            <Text accessibilityRole="header" style={{ ...s.text, fontSize: 22, fontWeight: '700' }}>Build your workflow</Text>
            <Input label="Workflow name" value={draft.name} max={80} onChange={name => patch({ name })} />
            <Input label="Description" value={draft.description} max={1000} onChange={description => patch({ description })} />
            <Text style={s.text}>Coordinator machine</Text>
            <Text style={s.muted}>Choose a machine to discover its models. Agents start only when you run the saved workflow.</Text>
            <WorkflowSelect label="Machine" value={machine?.metadata?.displayName || machine?.metadata?.host || 'Choose machine'} selected={machine?.id ?? ''} options={machines.map(m => ({ value: m.id, label: m.metadata?.displayName || m.metadata?.host || m.id, description: isMachineOnline(m) ? 'Online' : 'Offline' }))} onSelect={onMachine} />
            {(machine?.metadata?.workflows?.version ?? 0) < 3 && workflowSlots(draft).some(slot => slot.agent.provider !== 'codex') && <Text style={s.muted}>Workflows with multiple providers require the latest Talos CLI. You can save now; update the coordinator before running.</Text>}
            {(machine?.metadata?.workflows?.version ?? 0) < 2 && <Text style={s.muted}>Editable stages require the updated Talos CLI. You can design and save now; upgrade the coordinator before running.</Text>}

        </View>
        <View style={{ gap: 6 }}><Text accessibilityRole="header" style={{ ...s.text, fontSize: 22, fontWeight: '700' }}>Steps</Text><Text style={s.muted}>Start with planning and finish with review. Add up to three agents to a planning or review step. Execution steps each have one owner.</Text></View>
        {steps.map((step, index) => <View key={step.id} ref={node => { if (node) stepViews.current.set(step.id, node); else stepViews.current.delete(step.id); }} collapsable={false} style={{ gap: 10 }}>
            <View style={s.card}>
                <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: s.colors.divider, alignItems: 'center', justifyContent: 'center' }}><Text style={{ ...s.text, ...Typography.header() }}>{index + 1}</Text></View><View style={{ flex: 1 }}><Text style={{ ...s.text, ...Typography.header(), fontSize: 18 }}>{step.name}</Text><Text style={{ ...s.muted, fontSize: 12 }}>{stepLabels[step.kind]} · {step.agents.length}/{step.kind === 'execute' ? 1 : 3} agents</Text></View></View>
                <Text style={s.muted}>{step.kind === 'execute' ? 'One executor · workspace edits' : 'Every participant must approve · read-only'}</Text>
                {step.agents.map((slot, slotIndex) => <View key={`${slot.agent.id}-${slotIndex}`} style={{ borderTopWidth: 1, borderColor: s.colors.divider, paddingTop: 12, gap: 6 }}>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${slot.agent.name} in step ${index + 1}`} onPress={() => editAgent(step, slotIndex)} style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12 }}><View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: s.colors.divider, justifyContent: 'center', alignItems: 'center' }}><Text style={{ ...s.text, ...Typography.header() }}>{slot.agent.name.charAt(0).toUpperCase()}</Text></View><View style={{ flex: 1 }}><Text style={{ ...s.text, ...Typography.header() }}>{slot.agent.name}</Text><Text style={{ ...s.muted, fontSize: 12 }}>{agentProviders.find(p => p.code === slot.agent.provider)?.name} · {slot.agent.modelLabel || (slot.agent.model === 'default' ? 'Provider default' : slot.agent.model)}{slot.agent.effort ? ` · ${slot.agent.effort}` : ''}</Text></View><Ionicons name="chevron-forward" size={17} color={s.colors.textSecondary} /></Pressable>
                    {expanded === step.id && <View style={s.row}><Button label="Replace" accessibilityLabel={`Replace ${slot.agent.name} in step ${index + 1}`} onPress={() => { setPicker({ stepId: step.id, replacing: slotIndex }); setEditing(null); setError(''); }} /><Button label="Remove" accessibilityLabel={`Remove ${slot.agent.name} from step ${index + 1}`} onPress={() => { closeAgent(); patchStep(step.id, { agents: step.agents.filter((_, i) => i !== slotIndex) }); }} /></View>}
                    {expanded === step.id && <Input label={`${slot.agent.name} assignment in step ${index + 1}`} value={slot.assignment} multiline onChange={assignment => patchStep(step.id, { agents: step.agents.map((a, i) => i === slotIndex ? { ...a, assignment } : a) })} />}
                </View>)}
                {step.agents.length < (step.kind === 'execute' ? 1 : 3) && <Button label={`+ Add ${step.kind === 'plan' ? 'planner' : step.kind === 'execute' ? 'executor' : 'reviewer'}`} accessibilityLabel={`Add ${step.kind === 'plan' ? 'planner' : step.kind === 'execute' ? 'executor' : 'reviewer'} to step ${index + 1}`} onPress={() => { setPicker({ stepId: step.id }); setEditing(null); setError(''); }} />}
                <View style={s.row}><Button label={expanded === step.id ? 'Hide settings' : 'Stage settings'} accessibilityLabel={`${expanded === step.id ? 'Hide' : 'Customize'} step ${index + 1}`} onPress={() => setExpanded(expanded === step.id ? null : step.id)} />{expanded === step.id && <><Button label="↑" accessibilityLabel={`Move step ${index + 1} up`} disabled={index === 0 || !!picker} onPress={() => move(index, -1)} /><Button label="↓" accessibilityLabel={`Move step ${index + 1} down`} disabled={index === steps.length - 1 || !!picker} onPress={() => move(index, 1)} /><Button label="Remove step" accessibilityLabel={`Remove step ${index + 1}`} disabled={!!picker} onPress={() => onChange(withSteps(draft, steps.filter(s => s.id !== step.id)))} /></>}</View>
                {expanded === step.id && <>
                    <Input label={`Step ${index + 1} name`} value={step.name} max={80} onChange={name => patchStep(step.id, { name })} />
                    <Input label={`Step ${index + 1} criteria`} value={step.criteria} multiline onChange={criteria => patchStep(step.id, { criteria })} />
                    {step.kind === 'review' && <>
                        <Text style={s.muted}>Optional commands for this review gate. Workflow completion checks also run at the final review. Failed checks return work to the preceding executor.</Text>
                        {step.checks.map((check, i) => <View key={i} style={{ gap: 8 }}><Input label={`Step ${index + 1} check ${i + 1} name`} max={100} value={check.name} onChange={name => patchStep(step.id, { checks: step.checks.map((c, j) => j === i ? { ...c, name } : c) })} /><Input label={`Step ${index + 1} check ${i + 1} command`} max={2000} value={check.command} onChange={command => patchStep(step.id, { checks: step.checks.map((c, j) => j === i ? { ...c, command } : c) })} /><Button label={`Remove step ${index + 1} check ${i + 1}`} onPress={() => patchStep(step.id, { checks: step.checks.filter((_, j) => j !== i) })} /></View>)}
                        {step.checks.length < 8 && <Button label={`Add check to step ${index + 1}`} onPress={() => patchStep(step.id, { checks: [...step.checks, { name: '', command: '' }] })} />}
                    </>}
                </>}
            </View>
            {index < steps.length - 1 && <Text style={{ ...s.muted, paddingLeft: 18 }}>↓</Text>}
        </View>)}
        <Button label="Add step" disabled={steps.length >= 8 || !!picker} onPress={() => setAddingStep(!addingStep)} />
        {addingStep && <View style={s.card}><Text style={s.text}>Choose a step type</Text>{(['plan', 'execute', 'review'] as const).map(kind => <Button key={kind} label={`Add ${stepLabels[kind].toLowerCase()} step`} onPress={() => { const step = newWorkflowStep(kind); onChange(withSteps(draft, [...steps, step])); setExpanded(step.id); setAddingStep(false); }} />)}</View>}
        <View style={s.card}>
            <Text accessibilityRole="header" style={{ ...s.text, fontSize: 22, fontWeight: '700' }}>Finish line</Text>
            <Input label="Completion criteria" value={draft.criteria} multiline onChange={criteria => patch({ criteria })} />
            <Text style={s.muted}>These checks run at the final review, in the isolated worktree with your machine’s command permissions. Every check must pass.</Text>
            {draft.checks.map((check, index) => <View key={index} style={{ gap: 8 }}><Input label={`Check ${index + 1} name`} value={check.name} max={100} onChange={name => patch({ checks: draft.checks.map((c, i) => i === index ? { ...c, name } : c) })} /><Input label={`Check ${index + 1} command`} value={check.command} max={2000} onChange={command => patch({ checks: draft.checks.map((c, i) => i === index ? { ...c, command } : c) })} />{draft.checks.length > 1 && <Button label={`Remove check ${index + 1}`} onPress={() => patch({ checks: draft.checks.filter((_, i) => i !== index) })} />}</View>)}
            {draft.checks.length < 8 && <Button label="Add completion check" onPress={() => patch({ checks: [...draft.checks, { name: '', command: '' }] })} />}
            <Button selected={draft.approvePlan} label="Require my approval after planning consensus" onPress={() => patch({ approvePlan: !draft.approvePlan })} />
            <Button label={`${rules ? 'Hide' : 'Edit'} limits`} onPress={() => setRules(!rules)} />
            <Text style={s.muted}>{draft.planningRounds} rounds per planning step · {draft.reviewRounds} rounds per review step · {draft.maxTurns} turns total · {draft.turnMinutes} minutes per turn</Text>
            {rules && (['planningRounds', 'reviewRounds', 'turnMinutes', 'maxTurns'] as const).map((key, i) => <Input key={key} label={['Planning round limit (1–5)', 'Review round limit (1–5)', 'Minutes per agent turn (1–30)', 'Agent turn limit (8–100)'][i]} value={String(draft[key])} max={3} onChange={v => patch({ [key]: Number(v) })} />)}
        </View>
        <Text style={s.muted}>New agents and this workflow are saved together. Each run keeps its own configuration and evidence. No automatic merge, publication, or deployment.</Text>
        {!picker && error !== '' && <Text accessibilityRole="alert" style={{ ...s.text, color: s.colors.warning }}>{error}</Text>}
        <View style={s.row}><Button label="Cancel editing" onPress={onCancel} /><Button primary disabled={!!picker} label="Save workflow" onPress={() => {
            const missing = steps.findIndex(step => !step.agents.length);
            if (missing >= 0) { setError(`Add an agent to step ${missing + 1} before saving.`); setExpanded(steps[missing].id); return; }
            const parsed = WorkflowDefinitionSchema.safeParse(draft);
            if (!parsed.success) { setError(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('\n')); return; }
            setError(''); onSave();
        }} /></View>
    </View>;
}
