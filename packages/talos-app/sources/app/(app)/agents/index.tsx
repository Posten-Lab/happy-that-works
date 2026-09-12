import React from 'react';
import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { useAllMachines, useSetting, storage } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { useProviderModels } from '@/hooks/useProviderModels';
import { isMachineOnline } from '@/utils/machineUtils';
import { Modal } from '@/modal';
import { AgentDefinitionSchema, AgentLibrarySchema, agentTemplates, agentLibraryEnabled, agentLaunchError, type AgentDefinition } from '@/agents/agentDefinition';

const steps = ['Identity', 'Instructions', 'Runtime', 'Review'];
const newAgent = (): AgentDefinition => ({ id: randomUUID(), revision: 1, name: '', description: '', avatar: 'sparkles', provider: 'codex', model: '', effort: null, permissionMode: 'default', instructions: '', documents: [], specialties: [], updatedAt: Date.now() });

export default function AgentLibraryScreen() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const experiments = useSetting('experiments');
    const expWorkflows = useSetting('expWorkflows');
    const expAgentLibrary = useSetting('expAgentLibrary');
    const library = useSetting('agentLibrary');
    const machines = useAllMachines({ includeOffline: false }).filter(isMachineOnline);
    const [tab, setTab] = React.useState<'mine' | 'discover'>('mine');
    const [draft, setDraft] = React.useState<AgentDefinition | null>(null);
    const [original, setOriginal] = React.useState<AgentDefinition | null>(null);
    const [step, setStep] = React.useState(0);
    const [error, setError] = React.useState('');
    const [machineId, setMachineId] = React.useState('');
    const selectedMachine = machines.find(m => m.id === machineId) ?? machines[0];
    const models = useProviderModels('codex', selectedMachine ? [selectedMachine.id] : [], draft?.provider === 'codex');
    const chosenModel = models?.find(m => m.code === draft?.model);
    const colors = theme.colors;
    const card = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.divider, borderRadius: 16, padding: 20, gap: 12 } as const;
    const text = { color: colors.text, fontSize: 16 };
    const muted = { color: colors.textSecondary, fontSize: 14, lineHeight: 21 };
    const patch = (value: Partial<AgentDefinition>) => setDraft(d => d ? { ...d, ...value } : d);
    const button = (label: string, action: () => void, selected = false, disabled = false) => (
        <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={action}
            style={{ paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, backgroundColor: selected ? colors.accent : colors.surface, borderWidth: 1, borderColor: selected ? colors.accent : colors.divider, opacity: disabled ? 0.45 : 1 }}>
            <Text style={{ color: selected ? colors.button.primary.tint : colors.text, fontSize: 15, fontWeight: '600' }}>{label}</Text>
        </Pressable>
    );
    const input = (label: string, value: string, onChangeText: (value: string) => void, multiline = false, maxLength = 300) => (
        <View style={{ gap: 7 }}>
            <Text style={text}>{label}</Text>
            <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} multiline={multiline} maxLength={maxLength}
                style={{ ...text, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.divider, minHeight: multiline ? 140 : 48, textAlignVertical: 'top' }} />
        </View>
    );
    const begin = (value: AgentDefinition, existing: AgentDefinition | null = null) => { setDraft(value); setOriginal(existing); setStep(0); setError(''); };
    const leave = async () => {
        if (await Modal.confirm('Discard draft?', 'Your saved agents will not change.', { confirmText: 'Discard', cancelText: 'Keep editing' })) setDraft(null);
    };
    const attach = async () => {
        try {
            const result = await DocumentPicker.getDocumentAsync({ type: ['text/markdown', 'text/plain', 'text/x-markdown'], copyToCacheDirectory: true });
            if (result.canceled) return;
            const asset = result.assets[0];
            if (!/\.(md|markdown|txt)$/i.test(asset.name) || (asset.size ?? 0) > 64000) throw new Error('Choose a Markdown or text file up to 64 KB.');
            const content = asset.file ? await asset.file.text() : await new File(asset.uri).text();
            if (content.length > 16000) throw new Error('Each instruction file can contain up to 16,000 characters.');
            patch({ documents: [...(draft?.documents ?? []), { name: asset.name, content }] });
            setError('');
        } catch (e) { setError(e instanceof Error ? e.message : 'Could not read that file'); }
    };
    const next = () => {
        if (!draft) return;
        if (step === 0 && (!draft.name.trim() || !draft.description.trim())) return setError('Add a name and a description.');
        if (step === 1 && !draft.instructions.trim()) return setError('Add instructions for your agent.');
        if (step === 2) { const problem = agentLaunchError(draft, models); if (problem) return setError(problem); }
        setError(''); setStep(step + 1);
    };
    const save = () => {
        if (!draft) return;
        const state = storage.getState();
        if (!agentLibraryEnabled(state.settings)) return setError('The agent library is disabled. Enable it in Features to save.');
        const latest = state.settings.agentLibrary;
        if (original && JSON.stringify(latest.find(a => a.id === original.id)) !== JSON.stringify(original)) return setError('This agent changed on another screen or device. Reopen it before saving.');
        const parsed = AgentDefinitionSchema.safeParse({ ...draft, revision: (original?.revision ?? 0) + 1, updatedAt: Date.now() });
        if (!parsed.success) return setError(parsed.error.issues[0].message);
        if (!original && latest.length >= 100) return setError('Your library can hold up to 100 agents.');
        const nextLibrary = AgentLibrarySchema.safeParse([...latest.filter(a => a.id !== draft.id), parsed.data]);
        if (!nextLibrary.success) return setError(nextLibrary.error.issues[0].message);
        sync.applySettings({ agentLibrary: nextLibrary.data });
        setDraft(null); setTab('mine'); setError('');
    };
    if (!agentLibraryEnabled({ experiments, expAgentLibrary })) return <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
        <Text style={{ ...text, fontSize: 24, fontWeight: '700' }}>Agent library is experimental</Text>
        <Text style={muted}>Enable Experimental Features and Agent library in Settings → Features. Saved agents and existing sessions are preserved when it is off.</Text>
        {button('Open Features', () => router.push('/settings/features'))}
    </ScrollView>;

    return <ScrollView keyboardShouldPersistTaps="handled" style={{ backgroundColor: colors.groupped.background }} contentContainerStyle={{ padding: 20, paddingBottom: 60, gap: 20, maxWidth: 820, width: '100%', alignSelf: 'center' }}>
        <Text style={{ color: colors.accent, fontSize: 12, fontWeight: '700', letterSpacing: 2 }}>TALOS LABS · EXPERIMENTAL</Text>
        <Text accessibilityRole="header" style={{ ...text, fontSize: 30, fontWeight: '700' }}>{draft ? original ? 'Edit your agent' : 'Create your agent' : 'Your team, your way'}</Text>
        <Text style={muted}>{draft ? 'Give your specialist a clear role and a configuration you can inspect.' : 'Build specialists you can return to. Their instructions and configuration travel with each new session.'}</Text>
        {draft ? <>
            <Text style={{ ...text, fontWeight: '600' }}>Step {step + 1} of 4 · {steps[step]}</Text>
            <View style={card}>
                {step === 0 && <>
                    {input('Name', draft.name, name => patch({ name }), false, 60)}
                    {input('Description', draft.description, description => patch({ description }))}
                    <Text style={text}>Identity</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{(['compass', 'eye', 'brush', 'sparkles'] as const).map(avatar => button(avatar, () => patch({ avatar }), draft.avatar === avatar))}</View>
                    <Text style={text}>Specialties</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{(['development', 'review', 'operations', 'design'] as const).map(s => button(s, () => patch({ specialties: draft.specialties.includes(s) ? draft.specialties.filter(v => v !== s) : [...draft.specialties, s] }), draft.specialties.includes(s)))}</View>
                </>}
                {step === 1 && <>
                    {input('Instructions', draft.instructions, instructions => patch({ instructions }), true, 24000)}
                    <Text style={muted}>Describe how to work, when to ask you, and what a useful result looks like. Attached files are saved as a copy with the agent.</Text>
                    {draft.documents.map((d, i) => <View key={i} style={{ gap: 8 }}><Text style={text}>{d.name}</Text>{button(`Remove ${d.name}`, () => patch({ documents: draft.documents.filter((_, n) => n !== i) }))}</View>)}
                    {button('Attach Markdown instructions', () => { void attach(); }, false, draft.documents.length >= 5)}
                </>}
                {step === 2 && <>
                    <Text style={text}>Runtime</Text>
                    <Text style={text}>Codex</Text>
                    <Text style={muted}>This first experiment runs agents with Codex.</Text>
                    {draft.provider !== 'codex' && button('Use Codex', () => patch({ provider: 'codex', model: '', effort: null, permissionMode: 'default' }))}
                    <Text style={text}>Discover models on</Text>
                    {machines.map(m => button(m.metadata?.displayName || m.metadata?.host || m.id, () => { setMachineId(m.id); }, selectedMachine?.id === m.id))}
                    {!selectedMachine && <Text style={muted}>Connect a machine to choose a model. You can keep editing the other steps.</Text>}
                    <Text style={text}>Model</Text>
                    {models?.map(m => button(m.value, () => patch({ model: m.code, effort: m.defaultReasoningEffort ?? null }), draft.model === m.code))}
                    {!models && selectedMachine && <Text style={muted}>Waiting for the machine’s live model catalog…</Text>}
                    {chosenModel && <>
                        <Text style={text}>Reasoning effort</Text>
                        {button('Provider default', () => patch({ effort: null }), draft.effort === null)}
                        {chosenModel.supportedReasoningEfforts?.map(e => button(e.value, () => patch({ effort: e.code }), draft.effort === e.code))}
                    </>}
                    <Text style={text}>Permissions</Text>
                    {button('Ask for untrusted actions', () => patch({ permissionMode: 'default' }), draft.permissionMode === 'default')}
                    {draft.provider === 'codex' && button('Read only', () => patch({ permissionMode: 'read-only' }), draft.permissionMode === 'read-only')}
                    <Text style={muted}>This experiment supports text and code tasks. Browser, vision, and image-generation availability is not yet verified here. Specialties describe the agent’s focus; they do not grant tools or access.</Text>
                </>}
                {step === 3 && <>
                    <Text style={{ ...text, fontSize: 24, fontWeight: '700' }}>{draft.name}</Text><Text style={muted}>{draft.description}</Text>
                    <Text style={text}>{draft.provider} · {draft.model} · {draft.effort ?? 'provider default'} effort</Text>
                    <Text style={muted}>{draft.permissionMode === 'read-only' ? 'Read only' : 'Ask for untrusted actions'} · Direct sessions and experimental workflows</Text>
                    <Text selectable style={text}>{draft.instructions}</Text>
                    <Text style={muted}>{draft.documents.length} instruction files · {draft.specialties.join(', ') || 'General specialist'}</Text>
                    <Text style={muted}>Saved in your encrypted account settings. Editing this agent changes future sessions. Sessions already started retain their configuration. Use Workflows to assign saved agents to a planning and review team. Existing workflow runs keep their own snapshots.</Text>
                </>}
            </View>
            {error ? <Text accessibilityRole="alert" style={{ color: colors.textDestructive }}>{error}</Text> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {step > 0 && button('Back', () => { setStep(step - 1); setError(''); })}
                {step < 3 ? button('Continue', next, true) : button('Save agent', save, true)}
                {button('Cancel', () => { void leave(); })}
            </View>
        </> : <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{expWorkflows && button('Workflows', () => router.push('/workflows' as any))}
                {button('My agents', () => setTab('mine'), tab === 'mine')}{button('Discover', () => setTab('discover'), tab === 'discover')}{button('Create agent', () => begin(newAgent()))}</View>
            {tab === 'mine' && library.length === 0 && <View style={card}><Text style={{ ...text, fontSize: 20, fontWeight: '600' }}>Meet your next specialist</Text><Text style={muted}>Start with a template or create an agent around the work you do most often.</Text>{button('Explore templates', () => setTab('discover'), true)}</View>}
            {tab === 'discover' && agentTemplates.map(template => <View key={template.name} style={card}><Ionicons name={template.avatar} size={32} color={colors.accent} /><Text style={{ ...text, fontSize: 22, fontWeight: '600' }}>{template.name}</Text><Text style={muted}>{template.description}</Text><Text style={muted}>Talos template · Customize instructions and choose your model</Text>{button(`Customize ${template.name}`, () => begin({ ...newAgent(), ...template }))}</View>)}
            {tab === 'mine' && library.map(agent => <View key={agent.id} style={card}>
                <Ionicons name={agent.avatar} size={32} color={colors.accent} /><Text style={{ ...text, fontSize: 22, fontWeight: '600' }}>{agent.name}</Text><Text style={muted}>{agent.description}</Text><Text style={muted}>{agent.provider} · {agent.model} · v{agent.revision}</Text>
                {agent.provider !== 'codex' && <Text style={muted}>Edit this agent to choose Codex before starting a new session.</Text>}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {button(`Start ${agent.name}`, () => router.push({ pathname: '/new', params: { agentId: agent.id } } as any), true, agent.provider !== 'codex')}
                    {button(`Edit ${agent.name}`, () => begin({ ...agent, documents: [...agent.documents] }, agent))}
                    {button(`Duplicate ${agent.name}`, () => begin({ ...agent, id: randomUUID(), revision: 1, name: `${agent.name.slice(0, 54)} copy` }))}
                    {button(`Delete ${agent.name}`, () => { void (async () => { if (await Modal.confirm('Delete agent?', 'Existing sessions retain their configuration.', { confirmText: 'Delete', cancelText: 'Cancel' })) sync.applySettings({ agentLibrary: storage.getState().settings.agentLibrary.filter(a => a.id !== agent.id) }); })(); })}
                </View>
            </View>)}
        </>}
    </ScrollView>;
}
