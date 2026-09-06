import type { IntegrationEnvironment } from './integrationEnvironment';

declare global {
    // eslint-disable-next-line no-var
    var __talosIntegrationEnv: IntegrationEnvironment | undefined;
}

export function getIntegrationEnv(): IntegrationEnvironment {
    if (!globalThis.__talosIntegrationEnv) {
        throw new Error('No active integration environment');
    }

    return globalThis.__talosIntegrationEnv;
}
