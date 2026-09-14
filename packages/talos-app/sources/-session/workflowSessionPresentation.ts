import { WorkflowDecisionSchema, workflowStageLabel } from '@ahmadposten/talos-wire';
import type { Metadata } from '@/sync/storageTypes';
import type { Message } from '@/sync/typesMessage';

const decisionSchema = WorkflowDecisionSchema.extend({
    findings: WorkflowDecisionSchema.shape.findings.element.strict().array().max(20),
}).strict();

export function workflowParticipantName(metadata: Metadata | null | undefined): string | undefined {
    if (!metadata?.workflowManaged) return undefined;
    const name = metadata.name || metadata.summary?.text || 'Workflow participant';
    // Both workflow runtimes write this exact suffix; arbitrary user titles stay intact.
    const separator = name.lastIndexOf(' · '), stage = name.slice(separator + 3);
    return separator >= 0 && Object.prototype.hasOwnProperty.call(workflowStageLabel, stage)
        ? `${name.slice(0, separator)} · ${workflowStageLabel[stage as keyof typeof workflowStageLabel]}`
        : name;
}

export function workflowSessionFolder(metadata: Metadata | null | undefined): string | undefined {
    const folder = metadata?.path?.split(/[/\\]/).filter(Boolean).pop();
    if (metadata?.workflowManaged && (folder === metadata.workflowRunId || /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(folder ?? ''))) return undefined;
    return folder;
}

export function isWorkflowReminderMarker(message: Message, metadata: Metadata | null): boolean {
    return metadata?.workflowManaged === true && metadata.flavor === 'muse'
        && message.kind === 'agent-text' && message.text === 'reminderChild: Reminder child session';
}

export function workflowDecisionFromMessage(message: Message, metadata: Metadata | null) {
    if (!metadata?.workflowManaged || message.kind !== 'agent-text' || message.isThinking || message.text.length > 64000) return null;
    const text = message.text.trim();
    if (!text.startsWith('{') || !text.endsWith('}')) return null;
    try {
        const result = decisionSchema.safeParse(JSON.parse(text));
        return result.success ? result.data : null;
    } catch { return null; }
}

const assignmentMarkers = ['WORKFLOW STEP', 'STEP CRITERIA', 'STEP SEQUENCE', 'WORKFLOW ASSIGNMENT', 'TASK', 'ACCEPTANCE CRITERIA',
    'REQUIRED COMPLETION CHECKS', 'STEP CHECKS', 'STAGE', 'ROUND', 'PLAN VERSION', 'WORKSPACE REVISION', 'USER CLARIFICATIONS', 'EARLIER STEP RESULTS', 'EVIDENCE AND DISCUSSION'] as const;
const assignmentEnding = 'Do not invoke subagents or external actions outside this assignment. Never merge, publish, deploy, or send messages to others. The controller handles advancement. Return only the required structured result. Explain conclusions and evidence, not private reasoning.';

/** Recognize the coordinator's full native-provider envelope, never arbitrary user prose. */
export function workflowAssignmentFromMessage(message: Message, metadata: Metadata | null): { task: string; assignment: string } | null {
    if (!metadata?.workflowManaged || message.kind !== 'user-text' || message.meta?.sentFrom !== 'native-provider'
        || message.displayText && message.displayText !== message.text) return null;
    const text = message.text;
    if (text.length > 400000 || !text.startsWith('You are ') || !text.endsWith(`\n${assignmentEnding}`)) return null;
    const positions: number[] = [];
    for (const marker of assignmentMarkers) {
        const token = `${marker}: `, position = text.indexOf(token);
        // A marker quoted in the user's task/instructions makes extraction ambiguous.
        if (position < 1 || text[position - 1] !== '\n' || position !== text.lastIndexOf(token)
            || position <= (positions.at(-1) ?? -1)) return null;
        positions.push(position);
    }
    const field = (marker: typeof assignmentMarkers[number]) => {
        const index = assignmentMarkers.indexOf(marker);
        return text.slice(positions[index] + marker.length + 2, positions[index + 1] - 1).trim();
    };
    if (!Object.prototype.hasOwnProperty.call(workflowStageLabel, field('STAGE')) || !/^\d+$/.test(field('ROUND').split('\n')[0])
        || !/^\d+$/.test(field('PLAN VERSION').split('\n')[0])) return null;
    try {
        for (const marker of ['REQUIRED COMPLETION CHECKS', 'STEP CHECKS', 'USER CLARIFICATIONS'] as const) {
            if (!Array.isArray(JSON.parse(field(marker)))) return null;
        }
    } catch { return null; }
    const task = field('TASK'), assignment = field('WORKFLOW ASSIGNMENT');
    return task && assignment ? { task, assignment } : null;
}
