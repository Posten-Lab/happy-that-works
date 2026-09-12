import { expect, it } from 'vitest';
import { legacyInstallation } from '@ahmadposten/talos-wire';
import { workflowEnvironment } from './environment';
it('removes inherited session routing while retaining provider authentication only where required', () => {
    const env = { PATH: '/bin', HOME: '/home/test', CODEX_HOME: '/private/codex', CODEX_THREAD_ID: 'parent', TALOS_SESSION_ID: 'parent', [legacyInstallation.homeEnvironment]: '/parent', CLAUDE_SESSION_ID: 'parent', EMPTY: undefined };
    expect(workflowEnvironment(env, true)).toEqual({ PATH: '/bin', HOME: '/home/test', CODEX_HOME: '/private/codex' });
    expect(workflowEnvironment(env, false)).toEqual({ PATH: '/bin', HOME: '/home/test' });
});
