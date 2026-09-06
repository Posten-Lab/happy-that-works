import { describe, expect, it } from 'vitest';
import { mergeCodexProviderModels } from '@/utils/codexProviderModels';

describe('mergeCodexProviderModels', () => {
    it('unions live catalogs from every online machine without losing provider efforts', () => {
        expect(mergeCodexProviderModels([
            [{
                code: 'gpt-6-astra',
                value: 'GPT-6-Astra',
                isDefault: true,
                supportedReasoningEfforts: [
                    { code: 'medium', value: 'medium' },
                    { code: 'ultra', value: 'ultra' },
                ],
            }],
            [
                {
                    code: 'gpt-6-astra',
                    value: 'GPT-6-Astra',
                    supportedReasoningEfforts: [
                        { code: 'medium', value: 'medium' },
                        { code: 'max', value: 'max' },
                    ],
                },
                { code: 'gpt-5.6-sol', value: 'GPT-5.6-Sol' },
            ],
        ])).toEqual([
            {
                code: 'gpt-6-astra',
                value: 'GPT-6-Astra',
                description: undefined,
                defaultReasoningEffort: undefined,
                isDefault: true,
                supportedReasoningEfforts: [
                    { code: 'medium', value: 'medium' },
                    { code: 'ultra', value: 'ultra' },
                    { code: 'max', value: 'max' },
                ],
            },
            {
                code: 'gpt-5.6-sol',
                value: 'GPT-5.6-Sol',
                supportedReasoningEfforts: undefined,
            },
        ]);
    });

    it('preserves the provider order from the first successful machine', () => {
        const models = mergeCodexProviderModels([
            [
                { code: 'astra', value: 'Astra' },
                { code: 'sol', value: 'Sol' },
            ],
            [{ code: 'terra', value: 'Terra' }],
        ]);

        expect(models.map((model) => model.code)).toEqual(['astra', 'sol', 'terra']);
    });
});
