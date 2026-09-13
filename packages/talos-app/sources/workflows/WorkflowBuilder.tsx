import React from 'react';
import { Text, View } from 'react-native';
import { WorkflowDefinitionSchema, WorkflowAgentSchema, workflowSlots, type WorkflowDefinition, type WorkflowStep } from '@ahmadposten/talos-wire';
import { randomUUID } from 'expo-crypto';
import { AgentDefinitionSchema, agentLaunchError, type AgentDefinition } from '@/agents/agentDefinition';
import type { Machine } from '@/sync/storageTypes';
import { isMachineOnline } from '@/utils/machineUtils';
import { useMachineModelCatalog } from '@/hooks/useMachineModelCatalog';
import { WorkflowButton as Button, WorkflowInput as Input, useWorkflowStyles } from './ui';
import { attachWorkflowAgent, builderAgent, newWorkflowStep, stepLabels, withSteps } from './builder';

export function WorkflowBuilder({ draft, onChange, candidates, onCandidates, agents, machine, machines, onMachine, onSave, onCancel, onReveal }: {
    draft: WorkflowDefinition; onChange: (draft: WorkflowDefinition) => void;
    candidates: AgentDefinition[]; onCandidates: (agents: AgentDefinition[]) => void; agents: AgentDefinition[];
    machine: Machine | undefined; machines: Machine[]; onMachine: (id: string) => void; onSave: () => void; onCancel: () => void; onReveal: (node: View | null) => void;
}) {
    const s = useWorkflowStyles(), steps = draft.steps!;
    const stepViews = React.useRef(new Map<string, View>());
    const [expanded, setExpanded] = React.useState<string | null>(null);
    const [addingStep, setAddingStep] = React.useState(false), [rules, setRules] = React.useState(false);
    const [error, setError] = React.useState('');
    const [picker, setPicker] = React.useState<{ stepId: string; replacing?: number } | null>(null);
    const [editing, setEditing] = React.useState<AgentDefinition | null>(null);
    const [modelPicker, setModelPicker] = React.useState(false);
    const catalog = useMachineModelCatalog(machine && isMachineOnline(machine) ? machine.id : null);
    const selectedStep = steps.find(step => step.id === picker?.stepId);
    const library = [...agents.filter(a => a.provider === 'codex'), ...candidates];
    const patch = (value: Partial<WorkflowDefinition>) => onChange({ ...draft, ...value });
    const patchStep = (id: string, value: Partial<WorkflowStep>) => onChange(withSteps(draft, steps.map(step => step.id === id ? { ...step, ...value } : step)));
    const move = (index: number, direction: number) => { const next = [...steps]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; onChange(withSteps(draft, next)); };
    const closeAgent = () => {
        const stepId = picker?.stepId;
        if (stepId) requestAnimationFrame(() => requestAnimationFrame(() => onReveal(stepViews.current.get(stepId) ?? null)));
        setPicker(null); setEditing(null); setError(''); setModelPicker(false); };
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
            const agent = AgentDefinitionSchema.parse(editing);
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
            provider: 'codex', id: candidate ? slot.agent.id : randomUUID(), name: candidate ? slot.agent.name : `${slot.agent.name.slice(0, 49)} (workflow)` });
        setError('');
    };
    const model = catalog.models.find(m => m.code === editing?.model);
    const editor = picker && selectedStep && <View style={{ ...s.card, borderColor: s.colors.accent }}>
        <Text accessibilityRole="header" style={{ ...s.text, fontSize: 20, fontWeight: '700' }}>{editing ? 'Configure agent' : `Add agent to ${selectedStep.name}`}</Text>
        {editing ? <>
            <Text style={s.muted}>Saved with this workflow into Agent Library. Editing an existing library agent creates a separate copy.</Text>
            <Input label="Agent name" value={editing.name} max={60} onChange={name => setEditing({ ...editing, name })} />
            <Input label="Agent description" value={editing.description} max={300} onChange={description => setEditing({ ...editing, description })} />
            <Button label={`Model: ${model?.value ?? (editing.model || 'Choose model')}`} onPress={() => setModelPicker(!modelPicker)} />
            {modelPicker && catalog.models.map(m => <Button key={m.code} selected={editing.model === m.code} label={`Use ${m.value}`} onPress={() => { setEditing({ ...editing, model: m.code, effort: m.defaultReasoningEffort ?? null }); setModelPicker(false); }} />)}
            <Text style={s.text}>Reasoning effort</Text>
            <View style={s.row}><Button selected={editing.effort === null} label="Provider default" onPress={() => setEditing({ ...editing, effort: null })} />{model?.supportedReasoningEfforts?.map(e => <Button key={e.code} selected={editing.effort === e.code} label={e.value} onPress={() => setEditing({ ...editing, effort: e.code })} />)}</View>
            <Text style={s.muted}>{selectedStep.kind === 'execute' ? 'Can edit files in the isolated worktree.' : 'Runs read-only in this step.'}</Text>
            <Input label="Agent instructions" value={editing.instructions} multiline onChange={instructions => setEditing({ ...editing, instructions })} />
            <Text style={s.text}>Reference files · {editing.documents.length}/5</Text>
            {editing.documents.map((document, index) => <View key={index} style={s.card}>
                <Input label={`Reference ${index + 1} filename`} value={document.name} max={120} onChange={name => setEditing({ ...editing, documents: editing.documents.map((d, i) => i === index ? { ...d, name } : d) })} />
                <Input label={`Reference ${index + 1} Markdown`} value={document.content} max={16000} multiline onChange={content => setEditing({ ...editing, documents: editing.documents.map((d, i) => i === index ? { ...d, content } : d) })} />
                <Button label={`Remove reference ${index + 1}`} onPress={() => setEditing({ ...editing, documents: editing.documents.filter((_, i) => i !== index) })} />
            </View>)}
            {editing.documents.length < 5 && <Button label="Add reference file" onPress={() => setEditing({ ...editing, documents: [...editing.documents, { name: 'instructions.md', content: '' }] })} />}
            <View style={s.row}><Button label="Cancel agent" onPress={closeAgent} /><Button primary label="Use this agent" disabled={catalog.status !== 'ready'} onPress={saveAgent} /></View>
        </> : <>
            <Button primary label="Create new agent" disabled={catalog.status !== 'ready'} onPress={startAgent} />
            <Text style={s.muted}>{library.length ? 'Or choose an agent from your library' : 'Your library is empty. Create an agent here to get started.'}</Text>
            {library.map(agent => <Button key={agent.id} label={`Add ${agent.name}`} disabled={selectedStep.agents.some((slot, i) => i !== picker.replacing && slot.agent.id === agent.id)} onPress={() => selectAgent(agent)} />)}
            <Button label="Cancel agent" onPress={closeAgent} />
        </>}
        {error !== '' && <Text accessibilityRole="alert" style={{ ...s.text, color: s.colors.warning }}>{error}</Text>}
    </View>;
    return <View style={{ gap: 20 }}>
        <View style={s.card}>
            <Text accessibilityRole="header" style={{ ...s.text, fontSize: 22, fontWeight: '700' }}>Build your workflow</Text>
            <Input label="Workflow name" value={draft.name} max={80} onChange={name => patch({ name })} />
            <Input label="Description" value={draft.description} max={1000} onChange={description => patch({ description })} />
            <Text style={s.text}>Coordinator machine</Text>
            <Text style={s.muted}>Choose a machine to discover its models. Agents start only when you run the saved workflow.</Text>
            {machines.map(m => <Button key={m.id} selected={m.id === machine?.id} label={`${m.metadata?.displayName || m.metadata?.host || m.id}${!isMachineOnline(m) ? ' · offline' : ''}`} onPress={() => { onMachine(m.id); setModelPicker(false); }} />)}
            {(machine?.metadata?.workflows?.version ?? 0) < 2 && <Text style={s.muted}>Editable stages require the updated Talos CLI. You can design and save now; upgrade the coordinator before running.</Text>}
            {catalog.status !== 'ready' && <Text accessibilityLiveRegion="polite" style={s.muted}>{catalog.status === 'loading' ? 'Loading available Codex models…' : catalog.status === 'error' ? catalog.error : 'Connect an online machine to configure new agents.'}</Text>}
            {catalog.status === 'error' && <Button label="Retry model discovery" onPress={catalog.retry} />}
        </View>
        <View style={{ gap: 6 }}><Text accessibilityRole="header" style={{ ...s.text, fontSize: 22, fontWeight: '700' }}>Steps</Text><Text style={s.muted}>Start with planning and finish with review. Add up to three agents to a planning or review step. Execution steps each have one owner.</Text></View>
        {steps.map((step, index) => <View key={step.id} ref={node => { if (node) stepViews.current.set(step.id, node); else stepViews.current.delete(step.id); }} collapsable={false} style={{ gap: 10 }}>
            <View style={{ ...s.card, borderColor: expanded === step.id ? s.colors.accent : s.colors.divider }}>
                <View style={s.row}><Text style={{ ...s.text, fontWeight: '700', flex: 1 }}>{index + 1}. {step.name}</Text><Text style={s.muted}>{stepLabels[step.kind]} · {step.agents.length}/{step.kind === 'execute' ? 1 : 3}</Text></View>
                <Text style={s.muted}>{step.kind === 'execute' ? 'One executor · workspace edits' : 'Every participant must approve · read-only'}</Text>
                {step.agents.map((slot, slotIndex) => <View key={`${slot.agent.id}-${slotIndex}`} style={{ borderTopWidth: 1, borderColor: s.colors.divider, paddingTop: 12, gap: 6 }}>
                    <Text style={{ ...s.text, fontWeight: '600' }}>{slot.agent.name}</Text><Text style={s.muted}>{slot.agent.model} · {slot.agent.effort ?? 'default'} effort</Text>
                    <View style={s.row}><Button label="Edit" accessibilityLabel={`Edit ${slot.agent.name} in step ${index + 1}`} onPress={() => editAgent(step, slotIndex)} /><Button label="Replace" accessibilityLabel={`Replace ${slot.agent.name} in step ${index + 1}`} onPress={() => { setPicker({ stepId: step.id, replacing: slotIndex }); setEditing(null); setError(''); }} /><Button label="Remove" accessibilityLabel={`Remove ${slot.agent.name} from step ${index + 1}`} onPress={() => { closeAgent(); patchStep(step.id, { agents: step.agents.filter((_, i) => i !== slotIndex) }); }} /></View>
                    {expanded === step.id && <Input label={`${slot.agent.name} assignment in step ${index + 1}`} value={slot.assignment} multiline onChange={assignment => patchStep(step.id, { agents: step.agents.map((a, i) => i === slotIndex ? { ...a, assignment } : a) })} />}
                </View>)}
                {step.agents.length < (step.kind === 'execute' ? 1 : 3) && <Button primary label={`+ Add ${step.kind === 'plan' ? 'planner' : step.kind === 'execute' ? 'executor' : 'reviewer'}`} accessibilityLabel={`Add ${step.kind === 'plan' ? 'planner' : step.kind === 'execute' ? 'executor' : 'reviewer'} to step ${index + 1}`} onPress={() => { setPicker({ stepId: step.id }); setEditing(null); setError(''); }} />}
                {picker?.stepId === step.id && editor}
                <View style={s.row}><Button label={expanded === step.id ? 'Hide details' : 'Customize'} accessibilityLabel={`${expanded === step.id ? 'Hide' : 'Customize'} step ${index + 1}`} onPress={() => setExpanded(expanded === step.id ? null : step.id)} /><Button label="↑" accessibilityLabel={`Move step ${index + 1} up`} disabled={index === 0 || !!picker} onPress={() => move(index, -1)} /><Button label="↓" accessibilityLabel={`Move step ${index + 1} down`} disabled={index === steps.length - 1 || !!picker} onPress={() => move(index, 1)} /><Button label="Remove step" accessibilityLabel={`Remove step ${index + 1}`} disabled={!!picker} onPress={() => onChange(withSteps(draft, steps.filter(s => s.id !== step.id)))} /></View>
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
        <Button primary label="Add step" disabled={steps.length >= 8 || !!picker} onPress={() => setAddingStep(!addingStep)} />
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
            const unavailable = workflowSlots(draft).map(slot => agentLaunchError({ ...builderAgent('', 'plan', '', null), ...slot.agent }, catalog.status === 'ready' ? catalog.models : null)).find(Boolean);
            if (catalog.status === 'ready' && unavailable) { setError(unavailable); return; }
            setError(''); onSave();
        }} /></View>
    </View>;
}
