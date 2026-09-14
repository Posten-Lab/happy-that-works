import React from 'react';
import { Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import type { Machine } from '@/sync/storageTypes';
import type { AgentDefinition } from '@/agents/agentDefinition';
import { agentLaunchError } from '@/agents/agentDefinition';
import { isMachineOnline } from '@/utils/machineUtils';
import { useMachineModelCatalog } from '@/hooks/useMachineModelCatalog';
import { WorkflowButton as Button, useWorkflowStyles } from './ui';
import { createStarterTeam, savedWorkflowTeam } from './setup';
import { t } from '@/text';

export function WorkflowSetup({ machines, machine, agents, onMachine, onContinue, onCancel }: {
    machines: Machine[]; machine: Machine | undefined; agents: AgentDefinition[];
    onMachine: (id: string) => void; onContinue: (team: AgentDefinition[], additions: AgentDefinition[]) => void; onCancel: () => void;
}) {
    const s = useWorkflowStyles();
    const online = machine ? isMachineOnline(machine) : false;
    const supported = machine?.metadata?.workflows?.version === 1;
    const catalog = useMachineModelCatalog(online && supported ? machine!.id : null);
    const [source, setSource] = React.useState<'starter' | 'saved'>('starter');
    const [choice, setChoice] = React.useState<{ machineId: string; model: string; effort: string | null } | null>(null);
    const [picker, setPicker] = React.useState<'model' | 'effort' | null>(null);
    const [error, setError] = React.useState('');
    const model = choice && choice.machineId === machine?.id
        ? catalog.models.find(m => m.code === choice.model)
        : catalog.models.find(m => m.isDefault) ?? catalog.models[0];
    const effort = choice && choice.machineId === machine?.id ? choice.effort : model?.defaultReasoningEffort ?? null;
    const saved = savedWorkflowTeam(agents);
    const savedError = saved?.map(a => agentLaunchError(a, catalog.status === 'ready' ? catalog.models : null)).find(Boolean);
    const ready = online && supported && catalog.status === 'ready' && (source === 'starter' ? !!model : !!saved && !savedError);
    const next = () => {
        if (!ready || !model && source === 'starter') return;
        try {
            const team = source === 'starter' ? createStarterTeam(model!, effort, agents, randomUUID) : saved!;
            onContinue(team, source === 'starter' ? team : []);
        } catch (e) { setError(e instanceof Error ? e.message : 'Could not prepare the team.'); }
    };
    return <View style={{ gap: 16 }}>
        <Text style={{ ...s.text, fontWeight: '700' }}>Choose a machine and team</Text>
        <Text style={s.muted}>You do not need an existing session. This machine will run the workflow after you finish setup and enter a task.</Text>
        <View style={s.card}>
            <Text style={{ ...s.text, fontWeight: '700' }}>Coordinator machine</Text>
            {machines.map(m => <Button key={m.id} primary={machine?.id === m.id}
                label={`${m.metadata?.displayName || m.metadata?.host || m.id}${!isMachineOnline(m) ? ' · offline' : m.metadata?.workflows?.version !== 1 ? ' · CLI update required' : ''}`}
                onPress={() => { setError(''); setPicker(null); onMachine(m.id); }} />)}
            {!machine ? <Text style={s.muted}>Connect a machine using the Talos CLI to continue.</Text>
                : !online ? <Text accessibilityRole="alert" style={s.text}>This machine is offline. Start its Talos daemon or choose an online machine.</Text>
                    : !supported ? <Text accessibilityRole="alert" style={s.text}>Update Talos on this machine with npm install -g talosapp@latest, then restart its daemon to enable workflows.</Text>
                        : <>
                            <Text style={s.muted}>Selected: {machine.metadata?.displayName || machine.metadata?.host || machine.id}</Text>
                            {catalog.status === 'loading' && <Text accessibilityLiveRegion="polite" style={s.text}>Loading Codex models from this machine…</Text>}
                            {catalog.status === 'disconnected' && <Text accessibilityRole="alert" style={s.text}>Reconnect the app to the server to load this machine’s models.</Text>}
                            {catalog.status === 'error' && <><Text accessibilityRole="alert" style={{ ...s.text, color: s.colors.warning }}>{catalog.error}</Text><Button label="Retry model discovery" onPress={catalog.retry} /></>}
                        </>}
        </View>
        {catalog.status === 'ready' && <View style={s.card}>
            <Text style={{ ...s.text, fontWeight: '700' }}>Your team</Text>
            <Button label="Use a starter team" primary={source === 'starter'} onPress={() => setSource('starter')} />
            <Text style={s.muted}>Two planners, one executor, and two reviewers. You can edit their names and instructions before saving. New agents are saved to Agent Library only when you save the workflow.</Text>
            <Button label="Use my saved agents" primary={source === 'saved'} disabled={!saved} onPress={() => setSource('saved')} />
            {!saved && <Text style={s.muted}>To use saved agents, you need five distinct Codex agents, including one that allows edits. The starter team works with an empty library.</Text>}
            {source === 'saved' && <>
                <Text style={s.text}>{saved?.map(a => a.name).join(' · ')}</Text>
                {savedError && <Text accessibilityRole="alert" style={{ ...s.text, color: s.colors.warning }}>{savedError} You can use a starter team with a model available on this machine.</Text>}
            </>}
            {source === 'starter' && <>
                <Button label={`Team model: ${model?.value ?? 'Choose a model'}`} onPress={() => setPicker(picker === 'model' ? null : 'model')} />
                {picker === 'model' && catalog.models.map(m => <Button key={m.code} primary={model?.code === m.code} label={`Use ${m.value}`} onPress={() => { setChoice({ machineId: machine!.id, model: m.code, effort: m.defaultReasoningEffort ?? null }); setPicker(null); }} />)}
                {model && <Button label={`Reasoning effort: ${effort ?? 'Provider default'}`} onPress={() => setPicker(picker === 'effort' ? null : 'effort')} />}
                {model && picker === 'effort' && <>
                    <Button label="Use provider default effort" onPress={() => { setChoice({ machineId: machine!.id, model: model.code, effort: null }); setPicker(null); }} />
                    {model.supportedReasoningEfforts?.map(e => <Button key={e.code} label={`Use ${e.value} effort`} onPress={() => { setChoice({ machineId: machine!.id, model: model.code, effort: e.code }); setPicker(null); }} />)}
                </>}
                <Text style={s.muted}>{t('workflowWorkspace.setupExecutorWorkspace')}</Text>
            </>}
        </View>}
        {error !== '' && <Text accessibilityRole="alert" style={{ ...s.text, color: s.colors.warning }}>{error}</Text>}
        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}><Button label="Cancel setup" onPress={onCancel} /><Button primary disabled={!ready} label="Continue to workflow details" onPress={next} /></View>
    </View>;
}
