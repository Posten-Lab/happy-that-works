import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { diffLines } from 'diff';
import { workflowStageLabel, workflowFindingId, type WorkflowRun, type WorkflowTask } from '@ahmadposten/talos-wire';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { workflowRPC } from './api';
import { WorkflowButton as Button, useWorkflowStyles } from './ui';

/** Cache only complete task records; a running task must refresh when its receipt changes. */
export function useWorkflowTask(run: WorkflowRun, task?: WorkflowTask) {
    const [value, setValue] = React.useState<WorkflowTask>();
    const [error, setError] = React.useState('');
    const [retry, setRetry] = React.useState(0);
    React.useEffect(() => {
        if (!task) { setValue(undefined); return; }
        let live = true;
        setValue(undefined); setError('');
        workflowRPC<WorkflowTask>(run.machineId, 'task', { id: run.id, taskId: task.id }).then(result => { if (live) setValue(result); })
            .catch(() => { if (live) setError('The machine is unavailable. Reconnect it to load the original evidence.'); });
        return () => { live = false; };
    }, [run.id, run.machineId, task?.id, task?.status, task?.completedAt, retry]);
    return { value: value?.id === task?.id ? value : undefined, error, retry: () => setRetry(n => n + 1) };
}

export function WorkflowTaskDetail({ run, task, onOpenTask, onSession }: { run: WorkflowRun; task: WorkflowTask; onOpenTask: (id: string) => void; onSession: (id: string) => void }) {
    const s = useWorkflowStyles();
    const { value, error, retry } = useWorkflowTask(run, task);
    const [prompt, setPrompt] = React.useState(false), [changes, setChanges] = React.useState(false);
    const previous = run.tasks.filter(t => t.stage === 'consolidate' && t.status === 'done' && t.stepId === task.stepId && t.attempt === task.attempt && run.tasks.indexOf(t) < run.tasks.indexOf(task)).at(-1);
    const before = useWorkflowTask(run, changes ? previous : undefined);
    React.useEffect(() => { setPrompt(false); setChanges(false); }, [task.id]);
    return <View style={{ gap: 14 }}>
        <Text accessibilityRole="header" style={{ ...s.text, fontWeight: '600', fontSize: 18 }}>{task.agentName} · {workflowStageLabel[task.stage]}</Text>
        <Text style={s.muted}>Round {task.round} · {task.version.replace('plan:', 'v')}{task.attempt ? ` · Attempt ${task.attempt}` : ''}</Text>
        {task.sessionId ? <Button label="Open full transcript" onPress={() => onSession(task.sessionId!)} /> : <Text style={s.muted}>The transcript is not available yet.</Text>}
        {error ? <><Text accessibilityRole="alert" style={s.muted}>{error}</Text><Button label="Retry evidence" onPress={retry} /></> : !value ? <ActivityIndicator color={s.colors.accent} /> : <>
            {!!value.assignment && <Text style={s.muted}>{value.assignment}</Text>}
            {!!value.result?.summary && <MarkdownView markdown={value.result.summary} />}
            {!!value.result?.document && <MarkdownView markdown={value.result.document} />}
            {value.result?.findings.map((finding, index) => <View key={workflowFindingId(value, index)} style={{ borderLeftWidth: 2, borderColor: finding.blocking ? s.colors.warning : s.colors.divider, paddingLeft: 12, gap: 6 }}>
                <Text style={{ ...s.text, fontWeight: '600' }}>{finding.blocking ? 'Objection' : 'Suggestion'} · {finding.title}</Text><MarkdownView markdown={finding.evidence} /><Text style={s.muted}>Required change</Text><MarkdownView markdown={finding.correction} />
            </View>)}
            {value.result?.findingResponses?.map((response, index) => <View key={index} style={{ gap: 6 }}><Text style={{ ...s.text, fontWeight: '600' }}>{response.status}</Text><MarkdownView markdown={response.evidence} /></View>)}
            {task.stage === 'consolidate' && previous && <Button label={changes ? 'Hide plan changes' : 'Compare with previous plan'} onPress={() => setChanges(!changes)} />}
            {changes && (before.error ? <><Text style={s.muted}>{before.error}</Text><Button label="Retry previous plan" onPress={before.retry} /></> : !before.value ? <ActivityIndicator /> : <View style={{ gap: 4 }}>
                <Text style={s.muted}>{previous?.version.replace('plan:', 'v')} → {task.version.replace('plan:', 'v')}</Text>
                {diffLines(before.value.result?.document ?? '', value.result?.document ?? '').map((part, index) => <Text selectable key={index} style={{ ...s.muted, padding: 8, backgroundColor: part.added ? s.colors.accentSoft : s.colors.surface, color: part.removed ? s.colors.textDestructive : s.colors.text }}>{part.added ? '+ ' : part.removed ? '− ' : ''}{part.value}</Text>)}
            </View>)}
            <Text style={{ ...s.text, fontWeight: '600' }}>What this agent received</Text>
            {value.inputs === undefined ? <Text style={s.muted}>Source links were not recorded for this older task. The original prompt is available below.</Text> : value.inputs.length === 0 ? <Text style={s.muted}>Independent proposal: no other participant’s output was shared.</Text> : value.inputs.map(input => {
                const source = run.tasks.find(t => t.id === input.taskId);
                return <Button key={input.taskId} label={`${source?.agentName ?? 'Earlier task'} · ${input.content} · ${source?.version.replace('plan:', 'v') ?? ''}`} variant="ghost" onPress={() => onOpenTask(input.taskId)} />;
            })}
            <Button label={prompt ? 'Hide original prompt' : 'Read original prompt'} variant="ghost" onPress={() => setPrompt(!prompt)} />
            {prompt && <Text selectable style={s.muted}>{value.prompt}</Text>}
        </>}
    </View>;
}
