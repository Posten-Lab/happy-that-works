import { describe, expect, it } from 'vitest';
import { getAgentDefaultEffortOptions, getAgentDefaultModelOptions } from './agentDefaultOptions';

const translate = (key: string) => key;
const liveCodexMetadata = {
    models: [{
        code: 'gpt-6-astra',
        value: 'GPT-6-Astra',
        isDefault: true,
        supportedReasoningEfforts: [
            { code: 'medium', value: 'medium' },
            { code: 'max', value: 'max' },
            { code: 'ultra', value: 'ultra' },
        ],
    }],
};

describe('agent default options', () => {
    it('shows provider-discovered models in the settings picker', () => {
        expect(getAgentDefaultModelOptions('codex', liveCodexMetadata, translate)).toEqual([{
            key: 'gpt-6-astra',
            name: 'GPT-6-Astra',
            description: null,
            isDefault: true,
            supportedReasoningEfforts: [
                { key: 'medium', name: 'medium', description: null },
                { key: 'max', name: 'max', description: null },
                { key: 'ultra', name: 'ultra', description: null },
            ],
        }]);
    });

    it('uses the advertised default model efforts in settings', () => {
        expect(getAgentDefaultEffortOptions('codex', 'default', liveCodexMetadata)
            .map((effort) => effort.key)).toEqual(['medium', 'max', 'ultra']);
    });
});
