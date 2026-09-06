import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

export type Config = {
    serverUrl: string;
    homeDir: string;
    credentialPath: string;
};

export function loadConfig(): Config {
    const homeDir = (process.env.TALOS_HOME_DIR || join(homedir(), '.talos')).replace(/^~(?=\/|$)/, homedir());
    let savedServerUrl: string | undefined;
    try {
        const settings = JSON.parse(readFileSync(join(homeDir, 'settings.json'), 'utf8'));
        if (typeof settings.serverUrl === 'string' && settings.serverUrl.length > 0) savedServerUrl = settings.serverUrl;
    } catch { /* A fresh installation has no saved relay yet. */ }
    const serverUrl = (process.env.TALOS_SERVER_URL || savedServerUrl || 'https://api.talosapp.ai').replace(/\/+$/, '');
    const credentialPath = join(homeDir, 'agent.key');
    return { serverUrl, homeDir, credentialPath };
}
