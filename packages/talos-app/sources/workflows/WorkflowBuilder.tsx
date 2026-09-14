import { AgentRuntimePicker } from '@/agents/AgentRuntimePicker';
import React from 'react';
import { Text, View, Modal as NativeModal, Pressable, Keyboard, Platform, useWindowDimensions } from 'react-native';
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
import { WorkflowButton as Button, WorkflowInput as Input, WorkflowSelect, WorkflowPickerContext, WorkflowSelectionList, type WorkflowSelection, useWorkflowStyles } from './ui';
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
        setExpanded(step.id); setPicker({ stepId: step.id, replacing: index });
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
            <Button primary label="Create new agent" disabled={!machine || !isMachineOnline(machine)} onPress={startAgent} />
            {(!machine || !isMachineOnline(machine)) && <Text style={s.muted}>Choose an online machine in the Team step to configure a new agent.</Text>}
            <Text style={s.muted}>{library.length ? 'Or choose an agent from your library' : 'Your library is empty. Create an agent here to get started.'}</Text>
            {library.map(agent => <Button key={agent.id} label={`Add ${agent.name}`} disabled={selectedStep.agents.some((slot, i) => i !== picker.replacing && slot.agent.id === agent.id)} onPress={() => selectAgent(agent)} />)}
        </>}
        </WorkflowPickerContext.Provider>
        </WorkflowScaffold>
        </>}
        </View>
        </View>
    </NativeModal>;
    return <View style={{ gap: 20 }}>
        {editor}
        {section === 'basics' && <View style={s.card}>
            <Input label="Workflow name" value={draft.name} placeholder="e.g. Ship a polished feature" hint="A clear name helps you choose this workflow later." max={80} onChange={name => patch({ name })} />
            <Input label="Description (optional)" value={draft.description} placeholder="What is this team especially good at?" multiline max={1000} onChange={description => patch({ description })} />
        </View>}
        {section === 'team' && <>
        <View style={{ ...s.card, padding: 12, gap: 6 }}>
            <WorkflowSelect label="Models from" value={machine?.metadata?.displayName || machine?.metadata?.host || 'Choose machine'} selected={machine?.id ?? ''} options={machines.map(m => ({ value: m.id, label: m.metadata?.displayName || m.metadata?.host || m.id, description: isMachineOnline(m) ? 'Online' : 'Offline' }))} onSelect={onMachine} />
            <Text style={{ ...s.muted, fontSize: 12, lineHeight: 18, paddingHorizontal: 2 }}>Model discovery only. Choose where to run later.</Text>
            {!machines.length && <Text style={s.muted}>Connect a machine from Settings → Machines to configure new agents. You can still use agents already in your library.</Text>}
            {machine && !isMachineOnline(machine) && <Text style={s.muted}>This machine is offline. Choose an online machine to configure a new agent, or choose an agent from your library.</Text>}
            {machine && (machine?.metadata?.workflows?.version ?? 0) < 3 && workflowSlots(draft).some(slot => slot.agent.provider !== 'codex') && <Text style={s.muted}>Workflows with multiple providers require the latest Talos CLI. You can save now; update the coordinator before running.</Text>}
            {machine && (machine?.metadata?.workflows?.version ?? 0) < 2 && <Text style={s.muted}>Editable stages require the updated Talos CLI. You can design and save now; upgrade the coordinator before running.</Text>}

        </View>
        <View style={{ gap: 4 }}><Text accessibilityRole="header" style={{ ...s.text, fontSize: 22, fontWeight: '700' }}>Your stages</Text><Text style={{ ...s.muted, fontSize: 12 }}>Up to 3 planners and reviewers · 1 executor</Text></View>
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
        </>}
        {section === 'finish' && <View style={s.card}>
            <Text accessibilityRole="header" style={{ ...s.text, ...Typography.header(), fontSize: 20 }}>Definition of done</Text>
            <Input label="Completion criteria" value={draft.criteria} placeholder="Describe the result, what reviewers should verify, and any boundaries." multiline onChange={criteria => patch({ criteria })} />
            <Text style={{ ...s.text, ...Typography.header(), marginTop: 8 }}>Completion checks</Text>
            <Text style={s.muted}>Add at least one command that verifies the result, such as pnpm test. These commands run in the workflow’s project copy. Every check must pass.</Text>
            {draft.checks.map((check, index) => <View key={index} style={{ gap: 8 }}><Input label={`Check ${index + 1} name`} value={check.name} max={100} onChange={name => patch({ checks: draft.checks.map((c, i) => i === index ? { ...c, name } : c) })} /><Input label={`Check ${index + 1} command`} value={check.command} max={2000} onChange={command => patch({ checks: draft.checks.map((c, i) => i === index ? { ...c, command } : c) })} />{draft.checks.length > 1 && <Button label={`Remove check ${index + 1}`} onPress={() => patch({ checks: draft.checks.filter((_, i) => i !== index) })} />}</View>)}
            {draft.checks.length < 8 && <Button label="Add completion check" onPress={() => patch({ checks: [...draft.checks, { name: '', command: '' }] })} />}
            <Button selected={draft.approvePlan} label="Require my approval after planning consensus" onPress={() => patch({ approvePlan: !draft.approvePlan })} />
            <Button label={`${rules ? 'Hide advanced limits' : 'Advanced limits'}`} onPress={() => setRules(!rules)} />
            <Text style={s.muted}>{draft.planningRounds} rounds per planning step · {draft.reviewRounds} rounds per review step · {draft.maxTurns} turns total · {draft.turnMinutes} minutes per turn</Text>
            {rules && (['planningRounds', 'reviewRounds', 'turnMinutes', 'maxTurns'] as const).map((key, i) => <Input key={key} label={['Planning round limit (1–5)', 'Review round limit (1–5)', 'Minutes per agent turn (1–30)', 'Agent turn limit (8–100)'][i]} value={limitValues[key]} numeric max={3} onChange={v => { setLimitValues({ ...limitValues, [key]: v }); patch({ [key]: v.trim() ? Number(v) : NaN }); }} />)}
        </View>}
    </View>;
}
