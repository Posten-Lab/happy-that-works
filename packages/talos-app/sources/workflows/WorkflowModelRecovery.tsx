import React from 'react';
import { Text, View } from 'react-native';
import type { WorkflowSlot } from '@ahmadposten/talos-wire';
import { useMachineModelCatalog } from '@/hooks/useMachineModelCatalog';
import { WorkflowButton as Button, WorkflowSelect, useWorkflowStyles } from './ui';

export function WorkflowModelRecovery({ machineId, slot, busy, onResume }: {
    machineId: string; slot: WorkflowSlot; busy: boolean;
    onResume: (choice: { model: string; effort: string | null }) => void;
}) {
    const s = useWorkflowStyles();
    const [open, setOpen] = React.useState(false), [choice, setChoice] = React.useState('');
    const catalog = useMachineModelCatalog(open ? machineId : null, slot.agent.provider);
    const model = catalog.models.find(item => item.code === choice);
    return <View style={{ gap: 10 }}>
        <Button label={open ? 'Hide model choices' : 'Switch model to continue'} variant="secondary" disabled={busy} onPress={() => setOpen(!open)} />
        {open && <>
            <Text style={s.muted}>Retry this Build step with a different model. Your approved plan and completed steps stay in place. The builder will inspect partial edits before continuing.</Text>
            {catalog.status === 'loading' && <Text accessibilityLiveRegion="polite" style={s.muted}>Loading available models…</Text>}
            {(catalog.status === 'error' || catalog.status === 'disconnected') && <><Text style={s.muted}>{catalog.error || 'Reconnect this machine to load its models.'}</Text><Button label="Retry model discovery" onPress={catalog.retry} /></>}
            {catalog.status === 'ready' && <>
                <WorkflowSelect label="Recovery model" value={model?.value ?? 'Choose a model'} selected={choice} disabled={busy}
                    options={catalog.models.filter(item => item.code !== slot.agent.model).map(item => ({ value: item.code, label: item.value }))} onSelect={setChoice} />
                <Button primary label="Switch model and resume" disabled={busy || !model || model.code === slot.agent.model}
                    onPress={() => model && onResume({ model: model.code, effort: model.supportedReasoningEfforts?.some(item => item.code === slot.agent.effort) ? slot.agent.effort : model.defaultReasoningEffort ?? null })} />
            </>}
        </>}
    </View>;
}
