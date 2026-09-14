import React from 'react';
import { workflowErrorMessage } from '@/workflows/errors';
import { Text, View } from 'react-native';
import { agentPermissionLabel, agentProviders, type AgentDefinition } from './agentDefinition';
import { useMachineModelCatalog } from '@/hooks/useMachineModelCatalog';
import { WorkflowButton as Button, WorkflowSelect, useWorkflowStyles } from '@/workflows/ui';

/** Catalogs and dependent choices are scoped to the selected provider and machine. */
export function AgentRuntimePicker({ agent, machineId, onChange, catalog: suppliedCatalog }: {
    agent: AgentDefinition; machineId: string | null; onChange: (value: Partial<AgentDefinition>) => void; catalog?: ReturnType<typeof useMachineModelCatalog>;
}) {
    const s = useWorkflowStyles();
    const discoveredCatalog = useMachineModelCatalog(suppliedCatalog ? null : machineId, agent.provider);
    const catalog = suppliedCatalog ?? discoveredCatalog;
    const model = catalog.models.find(m => m.code === agent.model);
    const provider = agentProviders.find(p => p.code === agent.provider)!;
    const efforts = model?.supportedReasoningEfforts ?? [];
    return <View style={{ gap: 8 }}>
        <View style={{ borderWidth: 1, borderColor: s.colors.divider, borderRadius: 14, overflow: 'hidden' }}>
            <WorkflowSelect label="Provider" value={provider.name} selected={agent.provider} options={agentProviders.map(p => ({ value: p.code, label: p.name }))}
                onSelect={value => { if (value !== agent.provider) onChange({ provider: value as AgentDefinition['provider'], model: '', modelLabel: undefined, effort: null, permissionMode: agent.permissionMode === 'read-only' && value !== 'codex' ? 'default' : agent.permissionMode }); }} />
            <WorkflowSelect label="Model" value={model?.value ?? (agent.model || 'Choose model')} selected={agent.model} disabled={catalog.status !== 'ready' || !catalog.models.length}
                options={catalog.models.map(m => ({ value: m.code, label: m.value }))} onSelect={value => { const next = catalog.models.find(m => m.code === value); onChange({ model: value, modelLabel: next?.value, effort: next?.defaultReasoningEffort ?? null }); }} />
            <WorkflowSelect label="Effort" value={!model ? 'Choose a model first' : !efforts.length ? 'Managed by provider' : efforts.find(e => e.code === agent.effort)?.value ?? 'Provider default'} selected={agent.effort ?? ''}
                disabled={!model || !efforts.length} options={[{ value: '', label: 'Provider default' }, ...efforts.map(e => ({ value: e.code, label: e.value }))]}
                onSelect={value => onChange({ effort: (value || null) as AgentDefinition['effort'] })} />
        </View>
        <WorkflowSelect label="Permissions" value={agentPermissionLabel(agent.permissionMode)} selected={agent.permissionMode}
            options={(['default', ...(agent.provider === 'codex' ? ['read-only'] : []), 'yolo'] as AgentDefinition['permissionMode'][]).map(value => ({ value, label: agentPermissionLabel(value) }))}
            onSelect={value => onChange({ permissionMode: value as AgentDefinition['permissionMode'] })} />
        {agent.permissionMode === 'yolo' && <Text style={s.muted}>New direct sessions run without approval prompts. Codex and Muse also disable sandboxing.</Text>}
        {catalog.status !== 'ready' && <Text accessibilityLiveRegion="polite" style={s.muted}>{catalog.status === 'loading' ? `Loading ${provider.name} models…` : catalog.status === 'error' ? workflowErrorMessage(catalog.error, `Couldn't load ${provider.name} models. Check its installation and sign-in on this machine, then retry.`) : `Connect an online machine to discover ${provider.name} models.`}</Text>}
        {catalog.status === 'error' && <Button label={`Retry ${provider.name} model discovery`} onPress={catalog.retry} />}
        {catalog.status === 'ready' && !catalog.models.length && <Text style={s.muted}>No models are available for this provider on this machine.</Text>}
        {catalog.status === 'ready' && !!agent.model && !model && <Text accessibilityRole="alert" style={s.muted}>Choose a model available on this machine.</Text>}
    </View>;
}
