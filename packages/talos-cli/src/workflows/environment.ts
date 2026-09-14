import { legacyInstallation } from '@ahmadposten/talos-wire';

/** Drop inherited session/fork routing while retaining the user's Codex authentication home. */
export function workflowEnvironment(source: NodeJS.ProcessEnv, keepCodexHome: boolean): Record<string, string> {
    const legacyPrefix = legacyInstallation.homeEnvironment.split('_')[0] + '_';
    const prefixes = ['TALOS_', legacyPrefix, 'CLAUDE_', 'CODEX_'];
    return Object.fromEntries(Object.entries(source).filter(([key, value]) => typeof value === 'string' &&
        (keepCodexHome && key === 'CODEX_HOME' || !prefixes.some(prefix => key.startsWith(prefix))))) as Record<string, string>;
}

/** Keep explicit Claude authentication configuration without inheriting session routing. */
export function claudeWorkflowEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
    const env = workflowEnvironment(source, false);
    for (const key of ['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) {
        if (source[key]) env[key] = source[key];
    }
    return env;
}
