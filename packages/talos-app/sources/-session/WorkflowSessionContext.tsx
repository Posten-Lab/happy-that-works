import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { workflowStageLabel } from '@ahmadposten/talos-wire';
import { Typography } from '@/constants/Typography';
import type { Session } from '@/sync/storageTypes';
import { loadWorkflowRun } from '@/workflows/api';
import { WorkflowAvatar, WorkflowButton, useWorkflowStyles } from '@/workflows/ui';
import { workflowParticipantName } from './workflowSessionPresentation';

export type ParticipantContext = { sessionId: string; workflowName: string; agentName: string; stage: string; stepId?: string; agentId?: string; siblings?: { name: string; sessionId: string }[] };

/** Identity belongs to the saved run; session online state does not describe task progress. */
export function useWorkflowParticipantContext(session: Session | null | undefined) {
    const sessionId = session?.id, managed = session?.metadata?.workflowManaged;
    const runId = session?.metadata?.workflowRunId, machineId = session?.metadata?.machineId;
    const [context, setContext] = React.useState<ParticipantContext | null>(null);
    React.useEffect(() => {
        let live = true;
        setContext(null);
        if (managed && sessionId && runId && machineId) {
            void loadWorkflowRun(machineId, runId).then(run => {
                const task = run.tasks.find(task => task.sessionId === sessionId);
                if (!live || !task) return;
                const stepName = run.definition.steps?.find(step => step.id === task.stepId)?.name;
                setContext({ sessionId, workflowName: run.definition.name, agentName: task.agentName,
                    stage: `${stepName ?? workflowStageLabel[task.stage]} · Round ${task.round} · ${task.version.replace('plan:', 'v')}`,
                    stepId: task.stepId ?? (['propose', 'consolidate', 'plan_vote'].includes(task.stage) ? 'plan' : task.stage === 'execute' ? 'execute' : 'review'), agentId: task.agentId,
                    siblings: [...new Map(run.tasks.filter(t => t.stepId === task.stepId && t.attempt === task.attempt && t.stage === task.stage && t.round === task.round && t.sessionId).map(t => [t.agentId, { name: t.agentName, sessionId: t.sessionId! }])).values()] });
            }).catch(() => {
                // Session history and the return action remain available when its coordinator is offline.
            });
        }
        return () => { live = false; };
    }, [sessionId, managed, runId, machineId]);
    return context?.sessionId === sessionId ? context : null;
}

export function WorkflowSessionContext({ session, identity }: { session: Session; identity: ParticipantContext | null }) {
    const router = useRouter(), s = useWorkflowStyles();
    const runId = session.metadata?.workflowRunId, machineId = session.metadata?.machineId;
    const agentName = identity?.agentName || workflowParticipantName(session.metadata) || 'Workflow participant';
    const flavor = session.metadata?.flavor;
    const provider = flavor === 'codex' ? 'Codex' : flavor === 'claude' ? 'Claude' : flavor === 'muse' ? 'Muse' : undefined;

    return <View style={{ padding: 14, gap: 8, borderWidth: 1, borderColor: s.colors.divider, borderRadius: 18, backgroundColor: s.colors.surface }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <WorkflowAvatar name={agentName} provider={provider} size={38} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text style={{ ...s.text, ...Typography.default('semiBold'), fontSize: 15, lineHeight: 21 }}>{agentName}</Text>
                <Text style={{ ...s.muted, fontSize: 12, lineHeight: 18 }}>{identity?.stage || 'Workflow participant'}{provider ? ` · ${provider}` : ''}</Text>
            </View>
        </View>
        {!!identity?.siblings?.length && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {identity.siblings.map(sibling => <WorkflowButton key={sibling.sessionId} label={sibling.name} accessibilityLabel={`Switch transcript to ${sibling.name}`} compact variant="ghost" disabled={sibling.sessionId === session.id} onPress={() => router.replace(`/session/${sibling.sessionId}` as any)} />)}
        </ScrollView>}
        {identity?.agentId && identity.stepId && runId && machineId && <WorkflowButton label={`All ${agentName} contributions`} compact variant="ghost" onPress={() => router.dismissTo(`/workflows/${runId}?machineId=${encodeURIComponent(machineId)}&teamStep=${encodeURIComponent(identity.stepId!)}&teamAgent=${encodeURIComponent(identity.agentId!)}&historyRequest=${Date.now()}` as any)} />}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 100 }}>
                <Ionicons name="git-network-outline" size={15} color={s.colors.textSecondary} />
                <Text numberOfLines={2} style={{ ...s.muted, flex: 1, fontSize: 12, lineHeight: 18 }}>{identity?.workflowName || 'Managed by a workflow'}</Text>
            </View>
            <WorkflowButton label="Back to workflow" icon="arrow-back" variant="ghost" compact onPress={() => router.dismissTo(runId && machineId
                ? `/workflows/${runId}?machineId=${encodeURIComponent(machineId)}` as any
                : '/workflows')} />
        </View>
    </View>;
}
