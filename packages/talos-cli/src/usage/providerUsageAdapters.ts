import { readClaudeUsageIdentity, matchClaudeUsageIdentity } from './claudeUsageIdentity';
import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ProviderUsageSnapshot, UsageProvider } from '@ahmadposten/talos-wire';
import { CodexAppServerClient } from '@/codex/codexAppServerClient';
import { claudeAccountKey, emptyUsage, normalizeClaudeUsage, normalizeCodexUsage } from './normalizeUsage';

/** Called only after reading identity from the same provider process that serves the usage. */
export type ResolveUsage = (accountKey: string | undefined, read: () => Promise<ProviderUsageSnapshot>) => Promise<ProviderUsageSnapshot>;
export type UsageAdapter = (resolve: ResolveUsage) => Promise<ProviderUsageSnapshot>;

export async function withUsageTimeout<T>(operation: () => Promise<T>, cleanup: () => Promise<void> | void, timeoutMs = 20_000): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            operation(),
            new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Provider usage timed out')), timeoutMs); }),
        ]);
    } finally {
        clearTimeout(timeout);
        await cleanup();
    }
}

export const readCodexUsage: UsageAdapter = async (resolve) => {
    const client = new CodexAppServerClient();
    return withUsageTimeout(async () => {
        await client.connect();
        const account = await client.readAccount();
        if (account.account?.type !== 'chatgpt') return normalizeCodexUsage(account, {});
        // account/read exposes email and plan, not the active workspace accountId.
        // Two workspaces can share both. Do not reuse quotas until identity can be
        // verified without fetching the quotas themselves; retain in-flight deduplication.
        return resolve(undefined, async () => normalizeCodexUsage(account, await client.readAccountRateLimits()));
    }, () => client.disconnect());
};

export const readClaudeUsage: UsageAdapter = async (resolve) => {
    let releaseInput!: () => void;
    const closed = new Promise<void>((done) => { releaseInput = done; });
    async function* idleInput(): AsyncGenerator<SDKUserMessage> { await closed; }
    const controller = new AbortController();
    const identityBefore = await readClaudeUsageIdentity();
    const client = query({
        prompt: idleInput(),
        options: {
            abortController: controller,
            persistSession: false,
            settingSources: ['user'],
            settings: { disableAllHooks: true },
            tools: [],
            mcpServers: {},
            strictMcpConfig: true,
            stderr: () => {},
        },
    });
    return withUsageTimeout(async () => {
        // Keep the unstable SDK method entirely inside this adapter.
        const usage = client.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
        if (typeof usage !== 'function') return emptyUsage('claude', 'unsupported', Date.now(), 'This Claude SDK version cannot read plan usage.');
        const account = await client.accountInfo();
        const identity = matchClaudeUsageIdentity(account, identityBefore, await readClaudeUsageIdentity());
        const result = await resolve(claudeAccountKey(account) ?? identity, async () => {
            const snapshot = normalizeClaudeUsage(account, await usage.call(client));
            if (snapshot.account && identity) snapshot.account.id = identity;
            return snapshot;
        });
        // Do not attribute a reading (including a cached one) after a sign-in switch.
        if (identity && matchClaudeUsageIdentity(account, identityBefore, await readClaudeUsageIdentity()) !== identity) {
            return emptyUsage('claude', 'unavailable', Date.now(), 'Your Claude sign-in changed. Refresh to read the current account.');
        }
        return result;
    }, () => { releaseInput(); controller.abort(); client.close(); });
};

/** Deliberately return fixed messages; provider errors can contain private account data. */
export function usageFailure(provider: UsageProvider, error: unknown, now = Date.now()): ProviderUsageSnapshot {
    const message = error instanceof Error ? error.message : '';
    if (/not installed|ENOENT|not found.*claude|Claude Code executable/i.test(message)) return emptyUsage(provider, 'unsupported', now, `Install ${provider === 'codex' ? 'Codex' : 'Claude'} on this machine to read usage.`);
    if (/method not found|unknown (?:method|variant)|not supported|unsupported.*(?:method|request)/i.test(message)) return emptyUsage(provider, 'unsupported', now, 'The installed provider version does not support reading plan usage.');
    if (/unauth|not (?:logged|signed) in|authentication|login required|no.auth|401/i.test(message)) return emptyUsage(provider, 'unauthenticated', now, 'Sign in to the provider on this machine to read usage.');
    if (/timed out|timeout|429|rate.limit|network|fetch|ECONN|ENOTFOUND/i.test(message)) return emptyUsage(provider, 'unavailable', now, 'Usage is temporarily unavailable. Try again later.');
    return emptyUsage(provider, 'error', now, 'Unable to read provider usage. Try again later.');
}
