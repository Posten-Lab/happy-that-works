import React from 'react';
// @ts-expect-error The workspace has react-test-renderer without its optional type package.
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowDecision } from '@ahmadposten/talos-wire';

vi.mock('react-native', () => ({ View: 'view', Text: 'text', Platform: { OS: 'web' } }));
vi.mock('@/components/markdown/MarkdownView', () => ({ MarkdownView: ({ markdown }: { markdown: string }) => React.createElement('markdown', null, markdown) }));
vi.mock('@/workflows/ui', () => ({
    useWorkflowStyles: () => ({ text: {}, muted: {}, colors: { divider: '#ddd', warning: '#b80', surface: '#fff' } }),
    WorkflowButton: ({ label, onPress }: { label: string; onPress: () => void }) => React.createElement('button', { onClick: onPress }, label),
    WorkflowStatusChip: ({ label }: { label: string }) => React.createElement('status-chip', null, label),
}));
import { WorkflowDecisionMessage } from './WorkflowDecisionMessage';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReturnType<typeof TestRenderer.create>;
afterEach(() => { if (renderer) act(() => renderer.unmount()); });
const response = (decision: WorkflowDecision['decision']): WorkflowDecision => ({ decision, summary: 'Inspecting the current project, then I will implement the approved plan.', document: 'Detailed evidence.', findings: [] });
async function render(decision: WorkflowDecision) {
    await act(async () => { renderer = TestRenderer.create(React.createElement(WorkflowDecisionMessage, { decision, raw: JSON.stringify(decision), sessionId: 'participant' })); });
}

describe('workflow transcript responses', () => {
    it.each(['information', 'approve', 'changes', 'replan'] as const)('does not turn an interim %s response into a task status', async decision => {
        await render(response(decision));
        expect(JSON.stringify(renderer.toJSON())).toContain('Agent response');
        expect(JSON.stringify(renderer.toJSON())).toContain('Inspecting the current project');
        expect(renderer.root.findAllByType('status-chip')).toHaveLength(0);
    });
    it('keeps blocking findings visible and the exact original response accessible', async () => {
        const decision = { ...response('changes'), findings: [{ title: 'Missing test coverage', evidence: 'The edge case fails.', correction: 'Add the missing case.', blocking: true }] };
        await render(decision);
        expect(JSON.stringify(renderer.toJSON())).toContain('Missing test coverage');
        const press = async (label: string) => {
            const button = renderer.root.findAllByType('button').find((node: { children: unknown[] }) => node.children.includes(label));
            expect(button).toBeDefined();
            await act(async () => button.props.onClick());
        };
        await press('Show response details');
        await press('Show original response');
        const textNodes = renderer.root.findAllByType('text');
        expect(textNodes.some((node: { children: unknown[] }) => node.children.includes(JSON.stringify(decision)))).toBe(true);
    });
});
