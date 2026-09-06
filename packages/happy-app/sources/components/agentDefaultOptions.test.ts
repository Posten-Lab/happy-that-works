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

const claudeMetadata = {
    models: [
        { code: 'default', value: 'Default (recommended)', isDefault: true, supportedReasoningEfforts: [{ code: 'high', value: 'high' }] },
        { code: 'future[1m]', value: 'Future Claude (1M context)', supportedReasoningEfforts: [{ code: 'max', value: 'max' }] },
        { code: 'haiku', value: 'Haiku', supportedReasoningEfforts: [] },
    ],
};

it('uses Claude discovery in settings, including no-effort models and the provider default', () => {
    expect(getAgentDefaultModelOptions('claude', claudeMetadata, translate).map(m => m.key)).toEqual(['future[1m]', 'haiku']);
    expect(getAgentDefaultEffortOptions('claude', 'default', claudeMetadata).map(e => e.key)).toEqual(['high']);
    expect(getAgentDefaultEffortOptions('claude', 'future[1m]', claudeMetadata).map(e => e.key)).toEqual(['max']);
    expect(getAgentDefaultEffortOptions('claude', 'haiku', claudeMetadata)).toEqual([]);
});
