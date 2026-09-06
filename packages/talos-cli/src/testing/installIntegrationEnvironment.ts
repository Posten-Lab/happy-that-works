import { afterAll } from 'vitest';
import {
    applyEnvironmentToProcess,
    createIntegrationEnvironment,
    destroyIntegrationEnvironment,
    type EnvironmentTemplate,
    type IntegrationEnvironment,
} from './integrationEnvironment';

type IntegrationEnvironmentProfile = {
    template: EnvironmentTemplate;
    up: boolean;
};

declare global {
    // eslint-disable-next-line no-var
    var __talosIntegrationEnv: IntegrationEnvironment | undefined;
}

export async function installIntegrationEnvironment(profile: IntegrationEnvironmentProfile) {
    const previousEnv = {
        TALOS_SERVER_URL: process.env.TALOS_SERVER_URL,
        TALOS_WEBAPP_URL: process.env.TALOS_WEBAPP_URL,
        TALOS_HOME_DIR: process.env.TALOS_HOME_DIR,
        TALOS_PROJECT_DIR: process.env.TALOS_PROJECT_DIR,
        TALOS_VARIANT: process.env.TALOS_VARIANT,
        DEBUG: process.env.DEBUG,
    };

    const env = await createIntegrationEnvironment(profile);
    applyEnvironmentToProcess(env);
    globalThis.__talosIntegrationEnv = env;

    afterAll(async () => {
        try {
            await destroyIntegrationEnvironment(env);
        } finally {
            for (const [key, value] of Object.entries(previousEnv)) {
                if (value === undefined) {
                    delete process.env[key];
                } else {
                    process.env[key] = value;
                }
            }

            if (globalThis.__talosIntegrationEnv?.name === env.name) {
                globalThis.__talosIntegrationEnv = undefined;
            }
        }
    });
}
