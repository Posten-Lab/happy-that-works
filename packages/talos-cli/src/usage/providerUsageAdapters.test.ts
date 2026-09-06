import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), readAccount: vi.fn(), readAccountRateLimits: vi.fn() }));
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mocks.query }));
vi.mock('@/codex/codexAppServerClient', () => ({ CodexAppServerClient: class {
    connect = mocks.connect; disconnect = mocks.disconnect; readAccount = mocks.readAccount; readAccountRateLimits = mocks.readAccountRateLimits;
} }));
import { readClaudeUsage, readCodexUsage, withUsageTimeout, type ResolveUsage } from './providerUsageAdapters';
const resolve: ResolveUsage = async (_key, read) => read();
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

describe('provider usage adapter lifecycle', () => {
    it('reads Codex metadata and usage without a thread or turn and disconnects', async () => {
        mocks.connect.mockResolvedValue(undefined);
        mocks.readAccount.mockResolvedValue({ account: { type: 'chatgpt', email: 'person@example.com', planType: 'pro' } });
        mocks.readAccountRateLimits.mockResolvedValue({ rateLimits: { primary: { usedPercent: 27, windowDurationMins: 10080, resetsAt: null } } });
        expect((await readCodexUsage(resolve)).windows[0].remainingPercent).toBe(73);
        expect(mocks.disconnect).toHaveBeenCalledOnce();
    });

    it('never offers an email/plan-derived Codex cache identity', async () => {
        mocks.connect.mockResolvedValue(undefined);
        mocks.readAccount.mockResolvedValue({ account: { type: 'chatgpt', email: 'person@example.com', planType: 'pro' } });
        mocks.readAccountRateLimits.mockResolvedValue({ rateLimits: {} });
        const resolver = vi.fn(resolve);
        await readCodexUsage(resolver);
        expect(resolver.mock.calls[0][0]).toBeUndefined();
    });

    it('always disconnects Codex after a failed read', async () => {
        mocks.connect.mockResolvedValue(undefined);
        mocks.readAccount.mockRejectedValue(new Error('network'));
        await expect(readCodexUsage(resolve)).rejects.toThrow('network');
        expect(mocks.disconnect).toHaveBeenCalledOnce();
    });

    it('uses an empty Claude input stream, disables persistence/hooks and closes on completion', async () => {
        const close = vi.fn();
        const usage = vi.fn(async () => ({ rate_limits_available: false, rate_limits: null }));
        mocks.query.mockReturnValue({ accountInfo: async () => ({}), usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: usage, close });
        expect((await readClaudeUsage(resolve)).status).toBe('unauthenticated');
        const args = mocks.query.mock.calls[0][0];
        expect(args.options).toMatchObject({ persistSession: false, tools: [], mcpServers: {}, strictMcpConfig: true, settings: { disableAllHooks: true } });
        expect(await args.prompt.next()).toEqual({ value: undefined, done: true });
        expect(args.options.abortController.signal.aborted).toBe(true);
        expect(close).toHaveBeenCalledOnce();
        expect(usage).toHaveBeenCalledOnce();
    });

    it('reports an unsupported Claude method without calling the model', async () => {
        const close = vi.fn();
        mocks.query.mockReturnValue({ close });
        expect((await readClaudeUsage(resolve)).status).toBe('unsupported');
        expect(close).toHaveBeenCalledOnce();
    });

    it('bounds unresponsive provider calls and runs cleanup', async () => {
        vi.useFakeTimers();
        const cleanup = vi.fn();
        const task = withUsageTimeout(() => new Promise(() => {}), cleanup, 100);
        const assertion = expect(task).rejects.toThrow('timed out');
        await vi.advanceTimersByTimeAsync(100);
        await assertion;
        expect(cleanup).toHaveBeenCalledOnce();
    });
});
