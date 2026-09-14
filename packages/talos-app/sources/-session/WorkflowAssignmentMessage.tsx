import React from 'react';
import { Text, View } from 'react-native';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { Typography } from '@/constants/Typography';
import { WorkflowButton, useWorkflowStyles } from '@/workflows/ui';

export function WorkflowAssignmentMessage({ task, assignment, raw, sessionId }: { task: string; assignment: string; raw: string; sessionId: string }) {
    const s = useWorkflowStyles(), [expanded, setExpanded] = React.useState(false);
    return <View style={{ marginHorizontal: 12, marginBottom: 12, padding: 16, gap: 10, borderRadius: 18, backgroundColor: s.colors.surfaceHigh }}>
        <Text style={{ ...s.text, ...Typography.default('semiBold'), fontSize: 15 }}>Assigned task</Text>
        <MarkdownView markdown={task} sessionId={sessionId} />
        {assignment !== task && <View style={{ gap: 4 }}>
            <Text style={{ ...s.muted, fontSize: 12 }}>This agent’s responsibility</Text>
            <Text numberOfLines={3} style={s.muted}>{assignment}</Text>
        </View>}
        <WorkflowButton label={expanded ? 'Hide full assignment' : 'Show full assignment'} variant="ghost" compact icon={expanded ? 'chevron-up' : 'chevron-down'} onPress={() => setExpanded(!expanded)} />
        {expanded && <MarkdownView markdown={raw} sessionId={sessionId} />}
    </View>;
}
