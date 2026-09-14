import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { workflowCleanApproval, workflowTaskInStep, type WorkflowRun } from '@ahmadposten/talos-wire';
import { workflowRunSteps, workflowParticipantState } from './runPresentation';
import { WorkflowAvatar, useWorkflowStyles } from './ui';

export type TeamSelection = { stepId: string; agentId: string | null };
export function WorkflowTeam({ run, selection, onSelect }: { run: WorkflowRun; selection: TeamSelection; onSelect: (value: TeamSelection) => void }) {
    const s = useWorkflowStyles();
    const { steps, currentIndex } = workflowRunSteps(run);
    const step = steps.find(step => step.id === selection.stepId) ?? steps[0];
    const tasks = run.tasks.filter(task => workflowTaskInStep(task, step.id, run));
    const latestAttempt = run.definition.steps && step.id === steps[currentIndex]?.id ? run.stepAttempt : tasks.at(-1)?.attempt;
    const current = tasks.filter(task => task.attempt === latestAttempt);
    const participants = [...step.agents.map(slot => ({ id: slot.agent.id, name: slot.agent.name, assignment: slot.assignment, provider: slot.agent.provider })),
        ...tasks.filter(task => !step.agents.some(slot => slot.agent.id === task.agentId)).filter((task, index, all) => all.findIndex(t => t.agentId === task.agentId) === index)
            .map(task => ({ id: task.agentId, name: task.agentName, assignment: 'Earlier participant', provider: undefined }))];
    return <View style={{ gap: 12 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {steps.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Inspect ${item.name} team`} accessibilityState={{ selected: item.id === step.id }} onPress={() => onSelect({ stepId: item.id, agentId: null })}
                style={{ minHeight: 44, padding: 10, borderRadius: 10, backgroundColor: item.id === step.id ? s.colors.accentSoft : s.colors.surface }}><Text style={{ ...s.muted, color: item.id === step.id ? s.colors.accent : s.colors.textSecondary }}>{item.name}</Text></Pressable>)}
        </ScrollView>
        <Pressable accessibilityRole="button" onPress={() => onSelect({ stepId: step.id, agentId: null })} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ ...s.text, fontWeight: '600' }}>{step.name} team · {participants.length}</Text><Text style={s.muted}>View everyone’s discussion</Text></Pressable>
        {participants.map(agent => {
            const task = current.filter(t => t.agentId === agent.id).at(-1);
            const vote = current.filter(t => t.agentId === agent.id && ['plan_vote', 'review'].includes(t.stage)).at(-1);
            return <Pressable key={agent.id} accessibilityRole="button" accessibilityLabel={`Inspect ${agent.name} history`} accessibilityState={{ selected: selection.agentId === agent.id }} onPress={() => onSelect({ stepId: step.id, agentId: agent.id })}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, backgroundColor: selection.agentId === agent.id ? s.colors.accentSoft : s.colors.surface, borderWidth: 1, borderColor: selection.agentId === agent.id ? s.colors.accent : s.colors.divider }}>
                <WorkflowAvatar name={agent.name} provider={agent.provider} size={34} />
                <View style={{ flex: 1, gap: 3 }}><Text style={{ ...s.text, fontWeight: '600', fontSize: 15 }}>{agent.name}</Text><Text style={{ ...s.muted, fontSize: 12 }} numberOfLines={1}>{agent.assignment}</Text>
                    <Text style={{ ...s.muted, fontSize: 12 }}>{task ? workflowParticipantState(run, task) : 'Waiting'}{vote ? `${task?.id === vote.id ? '' : ` · ${workflowCleanApproval(vote) ? 'Approved' : workflowParticipantState(run, vote)}`} ${vote.version.replace('plan:', 'v')}` : ''}</Text></View>
                <Text style={s.muted}>›</Text>
            </Pressable>;
        })}
    </View>;
}
