import { afterEach, describe, expect, it, vi } from 'vitest';
const { readFile } = vi.hoisted(() => ({ readFile: vi.fn() }));
vi.mock('node:fs/promises', () => ({ readFile }));
import { readClaudeUsageIdentity, matchClaudeUsageIdentity } from './claudeUsageIdentity';
const identity = { accountId: 'user-a', organizationId: 'org-a', email: 'a@example.com', organization: 'Workspace' };
const account = { email: identity.email, organization: identity.organization, apiProvider: 'firstParty' };
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('Claude account identity', () => {
    it('uses immutable user and workspace IDs, independent of the computer', () => {
        expect(matchClaudeUsageIdentity(account, identity, { ...identity })).toMatch(/^[a-f0-9]{64}$/);
        expect(matchClaudeUsageIdentity(account, identity, identity)).not.toBe(matchClaudeUsageIdentity(account,
            { ...identity, organizationId: 'org-b' }, { ...identity, organizationId: 'org-b' }));
    });
    it('rejects stale metadata, account switches, and third-party backends', () => {
        for (const changed of [{ accountId: 'user-b' }, { organizationId: 'org-b' }, { email: 'b@example.com' }]) {
            expect(matchClaudeUsageIdentity(account, identity, { ...identity, ...changed })).toBeUndefined();
        }
        expect(matchClaudeUsageIdentity({ ...account, email: 'b@example.com' }, identity, identity)).toBeUndefined();
        expect(matchClaudeUsageIdentity({ ...account, organization: 'Other' }, identity, identity)).toBeUndefined();
        expect(matchClaudeUsageIdentity({ ...account, apiProvider: 'bedrock' }, identity, identity)).toBeUndefined();
        expect(matchClaudeUsageIdentity(account, undefined, identity)).toBeUndefined();
    });
    it('reads metadata from the selected config directory without accessing credentials', async () => {
        vi.stubEnv('CLAUDE_CONFIG_DIR', '/tmp/selected-claude');
        for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR']) vi.stubEnv(key, '');
        readFile.mockResolvedValue(JSON.stringify({ oauthAccount: { accountUuid: identity.accountId, organizationUuid: identity.organizationId, emailAddress: identity.email, organizationName: identity.organization } }));
        expect(await readClaudeUsageIdentity()).toEqual(identity);
        expect(readFile).toHaveBeenCalledWith('/tmp/selected-claude/.claude.json', 'utf8');
    });
    it('does not associate an overridden token with the stored sign-in', async () => {
        vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'overridden');
        expect(await readClaudeUsageIdentity()).toBeUndefined();
        expect(readFile).not.toHaveBeenCalled();
    });
});
