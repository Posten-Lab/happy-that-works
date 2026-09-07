import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { claudeAccountKey, record } from './normalizeUsage';

export type ClaudeUsageIdentity = { accountId: string; organizationId: string; email: string; organization: string };

/** Claude persists OAuth account/workspace UUIDs outside its credentials file.
 * The SDK's accountInfo currently omits those UUIDs. Never use this metadata
 * for a token override or a different backend, and verify it around the read.
 */
export async function readClaudeUsageIdentity(): Promise<ClaudeUsageIdentity | undefined> {
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR
        || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY) return undefined;
    try {
        const file = process.env.CLAUDE_CONFIG_DIR
            ? join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : join(homedir(), '.claude.json');
        const account = record(record(JSON.parse(await readFile(file, 'utf8')))?.oauthAccount);
        if (!account) return undefined;
        const { accountUuid, organizationUuid, emailAddress, organizationName } = account;
        if (![accountUuid, organizationUuid, emailAddress, organizationName].every(value => typeof value === 'string' && value.trim())) return undefined;
        return { accountId: accountUuid as string, organizationId: organizationUuid as string,
            email: emailAddress as string, organization: organizationName as string };
    } catch { return undefined; }
}

export function matchClaudeUsageIdentity(accountInfo: unknown, before?: ClaudeUsageIdentity, after?: ClaudeUsageIdentity): string | undefined {
    const account = record(accountInfo);
    if (!before || !after || account?.apiProvider !== 'firstParty'
        || account.email !== before.email || account.organization !== before.organization
        || before.email !== after.email || before.organization !== after.organization) return undefined;
    const key = claudeAccountKey(before);
    return key && key === claudeAccountKey(after) ? key : undefined;
}
