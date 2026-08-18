import { describe, expect, it } from 'vitest';

import { CHANGE_TITLE_INSTRUCTION } from '@/gemini/constants';
import {
    buildCodexTurnPrompt,
    hashCodexEnhancedMode,
    PRESENT_IMAGE_INSTRUCTION,
    type CodexEnhancedMode,
} from './codexPrompt';

describe('buildCodexTurnPrompt', () => {
    it('prepends Happy append system prompt before the first Codex user message', () => {
        const prompt = buildCodexTurnPrompt({
            message: 'pick an option',
            mode: {
                appendSystemPrompt: '<options><option>Yes</option></options>',
            },
            includeAppendSystemPrompt: true,
            includeTitleInstruction: true,
        });

        expect(prompt).toBe(
            '<options><option>Yes</option></options>\n\n' +
            'pick an option\n\n' +
            CHANGE_TITLE_INSTRUCTION + '\n\n' +
            PRESENT_IMAGE_INSTRUCTION,
        );
    });

    it('preserves the existing first-turn title instruction when no append prompt is set', () => {
        const prompt = buildCodexTurnPrompt({
            message: 'hello',
            mode: {},
            includeAppendSystemPrompt: true,
            includeTitleInstruction: true,
        });

        expect(prompt).toBe(`hello\n\n${CHANGE_TITLE_INSTRUCTION}\n\n${PRESENT_IMAGE_INSTRUCTION}`);
    });

    it('does not inject Happy preamble on normal follow-up turns', () => {
        const prompt = buildCodexTurnPrompt({
            message: 'continue',
            mode: {
                appendSystemPrompt: '<options><option>Yes</option></options>',
            },
            includeAppendSystemPrompt: false,
            includeTitleInstruction: false,
        });

        expect(prompt).toBe('continue');
    });

    it('can re-inject Happy append prompt without title instruction after a thread reset', () => {
        const prompt = buildCodexTurnPrompt({
            message: 'start fresh',
            mode: {
                appendSystemPrompt: '<options><option>Yes</option></options>',
            },
            includeAppendSystemPrompt: true,
            includeTitleInstruction: false,
        });

        expect(prompt).toBe(
            '<options><option>Yes</option></options>\n\n' +
            'start fresh',
        );
    });

    it('adds non-image attachment paths to the turn prompt', () => {
        const prompt = buildCodexTurnPrompt({
            message: 'Can you inspect this CSV?',
            mode: {},
            includeAppendSystemPrompt: false,
            includeTitleInstruction: false,
            attachedFilePaths: ['/tmp/happy/csv-file.csv'],
        });

        expect(prompt).toBe(
            'Can you inspect this CSV?\n\n' +
            'Attached files are available at these local paths:\n' +
            '- /tmp/happy/csv-file.csv',
        );
    });
});

describe('hashCodexEnhancedMode', () => {
    it('separates queued Codex messages with different append system prompts', () => {
        const baseMode: CodexEnhancedMode = {
            permissionMode: 'default',
            model: 'gpt-5.5',
            effort: 'medium',
        };

        expect(hashCodexEnhancedMode({
            ...baseMode,
            appendSystemPrompt: 'options A',
        })).not.toBe(hashCodexEnhancedMode({
            ...baseMode,
            appendSystemPrompt: 'options B',
        }));
    });
});
