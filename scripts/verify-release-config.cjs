#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { productionStoreIdentity, applicationIdForVariant } = require('../packages/talos-app/store-identity.cjs');

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
    if (!['web', 'mobile', 'ios', 'android'].includes(target)) errors.push('Release target must be web, mobile, ios, or android.');
    if (['mobile', 'ios', 'android'].includes(target)) {
        const variant = env.APP_ENV || 'production';
        const projectId = env.TALOS_EAS_PROJECT_ID || (variant === 'production' ? productionStoreIdentity.easProjectId : '');
        const owner = env.TALOS_EXPO_OWNER || (variant === 'production' ? productionStoreIdentity.expoOwner : '');
        if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(projectId) ||
            (variant === 'production' && projectId !== productionStoreIdentity.easProjectId)) {
            errors.push('TALOS_EAS_PROJECT_ID must match the owned production update project, or a valid nonproduction project.');
        }
        if (!owner || (variant === 'production' && owner !== productionStoreIdentity.expoOwner)) errors.push('TALOS_EXPO_OWNER must match the owned production project owner.');
        let packageId;
        try {
            packageId = applicationIdForVariant(variant);
        } catch {
            errors.push('APP_ENV must be development, preview, or production.');
        }
        if (target !== 'ios') {
            try {
                const config = JSON.parse(fs.readFileSync(env.TALOS_GOOGLE_SERVICES_FILE, 'utf8'));
                if (!packageId || !config.client?.some(client => client.client_info?.android_client_info?.package_name === packageId)) throw new Error();
            } catch {
                errors.push('TALOS_GOOGLE_SERVICES_FILE must contain a Firebase client for this native application identifier.');
            }
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
