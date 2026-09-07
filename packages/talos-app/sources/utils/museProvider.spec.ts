import { describe, expect, it } from 'vitest';
import { getAvailableModels, getHardcodedPermissionModes, getEffortLevelsForModel, getDefaultEffortKeyForModel } from '@/components/modelModeOptions';
import { normalizeAgentKey, resolveAgentDefaultConfig } from '@/sync/agentDefaults';

describe('Muse provider UI configuration', () => {
    it('keeps Muse defaults independent of Claude', () => {
        expect(normalizeAgentKey('muse')).toBe('muse');
        expect(resolveAgentDefaultConfig({ claude: { modelMode: 'opus' } }, 'muse').modelMode).toBe('default');
    });
    it('keeps Muse on the resumable default even when native discovery offers other models', () => {
        expect(getAvailableModels('muse', undefined, key => key).map(m => m.key)).toEqual(['default']);
        expect(getAvailableModels('muse', { models: [{ code: 'native-model', value: 'Native model' }] }, key => key).map(m => m.key)).toEqual(['default']);
        expect(getHardcodedPermissionModes('muse', key => key).map(m => m.key)).toEqual(['default', 'safe-yolo', 'never', 'bypassPermissions', 'yolo']);
    });
    it('exposes every native effort while retaining the fixed model', () => {
        expect(getEffortLevelsForModel('muse', 'default').map(m => m.key)).toEqual(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
        expect(getDefaultEffortKeyForModel('muse', 'default')).toBe('high');
    });

});
