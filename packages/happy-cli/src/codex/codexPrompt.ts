import type { PermissionMode } from '@/api/types';
import { CHANGE_TITLE_INSTRUCTION } from '@/gemini/constants';
import { hashObject } from '@/utils/deterministicJson';

import type { ReasoningEffort } from './codexAppServerTypes';

export const PRESENT_IMAGE_INSTRUCTION = 'When showing an image in Happy, call mcp__happy__present_image with an absolute local image path. Do not embed local paths or private/authenticated URLs as Markdown images because remote clients cannot load them.';

export interface CodexEnhancedMode {
    permissionMode: PermissionMode;
    model?: string;
    /** Happy app instructions appended to the first Codex prompt for option chips. */
    appendSystemPrompt?: string;
    /** Reasoning effort passed through to Codex's sendTurnAndWait. */
    effort?: ReasoningEffort;
}

export function hashCodexEnhancedMode(mode: CodexEnhancedMode): string {
    return hashObject({
        permissionMode: mode.permissionMode,
        model: mode.model,
        appendSystemPrompt: mode.appendSystemPrompt,
        effort: mode.effort,
    });
}

export function buildCodexTurnPrompt(opts: {
    message: string;
    mode: Pick<CodexEnhancedMode, 'appendSystemPrompt'>;
    includeAppendSystemPrompt: boolean;
    includeTitleInstruction: boolean;
}): string {
    const parts: string[] = [];

    if (opts.includeAppendSystemPrompt && opts.mode.appendSystemPrompt) {
        parts.push(opts.mode.appendSystemPrompt);
    }

    parts.push(opts.message);

    if (opts.includeTitleInstruction) {
        parts.push(CHANGE_TITLE_INSTRUCTION, PRESENT_IMAGE_INSTRUCTION);
    }

    return parts.join('\n\n');
}
