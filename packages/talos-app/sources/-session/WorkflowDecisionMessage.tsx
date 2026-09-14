import React from 'react';
import { Text, View } from 'react-native';
import type { WorkflowDecision } from '@ahmadposten/talos-wire';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { Typography } from '@/constants/Typography';
import { WorkflowButton, useWorkflowStyles } from '@/workflows/ui';

export function WorkflowDecisionMessage({ decision, raw, sessionId }: { decision: WorkflowDecision; raw: string; sessionId: string }) {
    const s = useWorkflowStyles();
    const [expanded, setExpanded] = React.useState(false), [showRaw, setShowRaw] = React.useState(false);
    const blocking = decision.findings.filter(finding => finding.blocking);
    const inconsistent = decision.decision === 'approve' && blocking.length > 0;
    const findings = (items: WorkflowDecision['findings']) => items.map((finding, index) => <View key={index} style={{ gap: 4, paddingLeft: 12, borderLeftWidth: 2, borderColor: finding.blocking ? s.colors.warning : s.colors.divider }}>
        <Text style={{ ...s.text, ...Typography.default('semiBold'), fontSize: 15 }}>{finding.title}</Text>
        <MarkdownView markdown={finding.evidence} sessionId={sessionId} />
        <Text style={{ ...s.muted, fontSize: 12 }}>Required correction</Text>
        <MarkdownView markdown={finding.correction} sessionId={sessionId} />
    </View>);
    return <View style={{ marginHorizontal: 12, padding: 16, gap: 12, borderWidth: 1, borderRadius: 18, borderColor: s.colors.divider, backgroundColor: s.colors.surface }}>
        {/* Providers can emit valid result-shaped JSON during an unfinished turn.
            Only the workflow coordinator can establish the accepted task status. */}
        <Text style={{ ...s.text, ...Typography.default('semiBold'), fontSize: 15 }}>Agent response</Text>
        {inconsistent && <Text style={s.muted}>This agent reported approval with unresolved blocking findings. Review them in the workflow before continuing.</Text>}
        <MarkdownView markdown={decision.summary} sessionId={sessionId} />
        {findings(blocking)}
        <WorkflowButton label={expanded ? 'Hide response details' : 'Show response details'} variant="ghost" compact icon={expanded ? 'chevron-up' : 'chevron-down'} onPress={() => setExpanded(!expanded)} />
        {expanded && <>
            {!!decision.document && <MarkdownView markdown={decision.document} sessionId={sessionId} />}
            {findings(decision.findings.filter(finding => !finding.blocking))}
            <WorkflowButton label={showRaw ? 'Hide original response' : 'Show original response'} variant="ghost" compact onPress={() => setShowRaw(!showRaw)} />
            {showRaw && <Text selectable style={{ ...Typography.mono(), fontSize: 12, lineHeight: 18, color: s.colors.textSecondary }}>{raw}</Text>}
        </>}
    </View>;
}
