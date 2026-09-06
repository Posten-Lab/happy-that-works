import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { query, supportedModels, close } = vi.hoisted(() => ({
    query: vi.fn(), supportedModels: vi.fn(), close: vi.fn(),
}));
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query }));
import { discoverClaudeModels } from './claudeModels';

describe('Claude model discovery', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        query.mockReturnValue({ supportedModels, close });
    });
    afterEach(() => vi.useRealTimers());

    it('preserves provider selectors, names and efforts without submitting a chat turn', async () => {
        supportedModels.mockResolvedValue([
            { value: 'default', displayName: 'Default (recommended)', description: 'Provider default', supportedEffortLevels: ['medium', 'max'] },
            { value: 'future[1m]', resolvedModel: 'claude-future', displayName: 'Future (1M context)', description: 'New model', supportedEffortLevels: ['high'] },
            { value: 'haiku', displayName: 'Haiku', description: 'Fast' },
        ]);
        const models = await discoverClaudeModels();
        expect(models.map(m => [m.code, m.value, m.supportedReasoningEfforts?.map(e => e.code)])).toEqual([
            ['default', 'Default (recommended)', ['medium', 'max']],
            ['future[1m]', 'Future (1M context)', ['high']],
            ['haiku', 'Haiku', []],
        ]);
        expect(models[0].isDefault).toBe(true);
        const { prompt, options } = query.mock.calls[0][0];
        expect(options).toMatchObject({ persistSession: false, tools: [], mcpServers: {}, strictMcpConfig: true });
        expect(await prompt.next()).toEqual({ value: undefined, done: true });
        expect(options.abortController.signal.aborted).toBe(true);
        expect(close).toHaveBeenCalledOnce();
    });

    it('closes Claude when discovery fails', async () => {
        supportedModels.mockRejectedValue(new Error('Provider unavailable'));
        await expect(discoverClaudeModels()).rejects.toThrow('Provider unavailable');
        expect(close).toHaveBeenCalledOnce();
    });

    it('bounds a stuck provider and releases the input stream', async () => {
        vi.useFakeTimers();
        supportedModels.mockReturnValue(new Promise(() => {}));
        const pending = discoverClaudeModels();
        const assertion = expect(pending).rejects.toThrow('Claude model discovery timed out');
        await vi.advanceTimersByTimeAsync(15_000);
        await assertion;
        expect(close).toHaveBeenCalledOnce();
        expect(await query.mock.calls[0][0].prompt.next()).toEqual({ value: undefined, done: true });
    });
});
