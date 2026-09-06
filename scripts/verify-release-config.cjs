#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

/** Fail before a release can send Talos users to another product's services. */
function validateReleaseConfig(env = process.env, target = 'mobile') {
    const errors = [];
    for (const key of ['EXPO_PUBLIC_TALOS_SERVER_URL', 'EXPO_PUBLIC_TALOS_WEBAPP_URL']) {
        try {
            const url = new URL(env[key]);
            if (url.protocol !== 'https:' || /localhost|127\.0\.0\.1|\.example(?:\.|$)|happy|slopus|cluster-fluster/i.test(url.hostname)) throw new Error();
        } catch {
            errors.push(`${key} must be a configured Talos HTTPS address.`);
        }
    }
    if (target === 'mobile') {
        const projectId = env.TALOS_EAS_PROJECT_ID || '';
        if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(projectId) || projectId === '4445e993-5eaa-4a1a-8754-7068e8565e64') {
            errors.push('TALOS_EAS_PROJECT_ID must identify the new Talos update project.');
        }
        if (!env.TALOS_EXPO_OWNER) errors.push('TALOS_EXPO_OWNER is required.');
        try {
            const config = JSON.parse(fs.readFileSync(env.TALOS_GOOGLE_SERVICES_FILE, 'utf8'));
            const packageId = `com.ahposten.talos${env.APP_ENV && env.APP_ENV !== 'production' ? `.${env.APP_ENV === 'development' ? 'dev' : env.APP_ENV}` : ''}`;
            if (!config.client?.some(client => client.client_info?.android_client_info?.package_name === packageId)) throw new Error();
        } catch {
            errors.push('TALOS_GOOGLE_SERVICES_FILE must contain a Firebase client for the Talos application identifier.');
        }
    }
    return errors;
}

if (require.main === module) {
    const errors = validateReleaseConfig(process.env, process.argv[2] || 'mobile');
    if (errors.length) {
        console.error(`Talos release configuration is incomplete:\n${errors.map(error => `- ${error}`).join('\n')}`);
        console.error(`See ${path.resolve(__dirname, '../docs/rebrand/README.md')}`);
        process.exitCode = 1;
    } else {
        console.log('Talos release configuration verified.');
    }
}

module.exports = { validateReleaseConfig };
