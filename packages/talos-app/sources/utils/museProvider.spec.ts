import { describe, expect, it } from 'vitest';
import { getAvailableModels, getHardcodedPermissionModes } from '@/components/modelModeOptions';
import { normalizeAgentKey, resolveAgentDefaultConfig } from '@/sync/agentDefaults';

describe('Muse provider UI configuration', () => {
    it('keeps Muse defaults independent of Claude', () => {
        expect(normalizeAgentKey('muse')).toBe('muse');
        expect(resolveAgentDefaultConfig({ claude: { modelMode: 'opus' } }, 'muse').modelMode).toBe('default');
    });
    it('keeps Muse on the resumable default even when native discovery offers other models', () => {
        expect(getAvailableModels('muse', undefined, key => key).map(m => m.key)).toEqual(['default']);
        expect(getAvailableModels('muse', { models: [{ code: 'native-model', value: 'Native model' }] }, key => key).map(m => m.key)).toEqual(['default']);
        expect(getHardcodedPermissionModes('muse', key => key).map(m => m.key)).toEqual(['default', 'safe-yolo']);
    });
});
