import { homedir } from 'node:os';
import { join } from 'node:path';

export type Config = {
    serverUrl: string;
    homeDir: string;
    credentialPath: string;
};

export function loadConfig(): Config {
    const serverUrl = (process.env.TALOS_SERVER_URL ?? 'http://localhost:3005').replace(/\/+$/, '');
    const homeDir = process.env.TALOS_HOME_DIR ?? join(homedir(), '.talos');
    const credentialPath = join(homeDir, 'agent.key');
    return { serverUrl, homeDir, credentialPath };
}
