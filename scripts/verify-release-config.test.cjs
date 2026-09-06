const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateReleaseConfig } = require('./verify-release-config.cjs');
const { productionStoreIdentity } = require('../packages/talos-app/store-identity.cjs');

test('an unconfigured release cannot proceed', () => {
    assert.equal(validateReleaseConfig({}).length, 3);
});
test('rejects previous service domains while allowing the owned store update project', () => {
    const errors = validateReleaseConfig({
        EXPO_PUBLIC_TALOS_SERVER_URL: 'https://api.happy.ahposten.com',
        EXPO_PUBLIC_TALOS_WEBAPP_URL: 'https://app.happy.engineering',
        TALOS_EAS_PROJECT_ID: '4445e993-5eaa-4a1a-8754-7068e8565e64',
    });
    assert.ok(errors.some(error => error.startsWith('EXPO_PUBLIC_TALOS_SERVER_URL')));
    assert.ok(errors.some(error => error.startsWith('EXPO_PUBLIC_TALOS_WEBAPP_URL')));
    assert.ok(!errors.some(error => error.startsWith('TALOS_EAS_PROJECT_ID')));
});
test('preserves the installed Android package and rejects a Firebase client for another app', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'talos-release-'));
    const file = path.join(directory, 'google-services.json');
    const env = { EXPO_PUBLIC_TALOS_SERVER_URL: 'https://api.talos.test',
        EXPO_PUBLIC_TALOS_WEBAPP_URL: 'https://talos.test', TALOS_EXPO_OWNER: productionStoreIdentity.expoOwner,
        TALOS_EAS_PROJECT_ID: productionStoreIdentity.easProjectId, TALOS_GOOGLE_SERVICES_FILE: file };
    try {
        fs.writeFileSync(file, JSON.stringify({ client: [{ client_info: { android_client_info: { package_name: 'com.ahposten.happyimproved' } } }] }));
        assert.deepEqual(validateReleaseConfig(env), []);
        fs.writeFileSync(file, JSON.stringify({ client: [{ client_info: { android_client_info: { package_name: 'com.other.app' } } }] }));
        assert.equal(validateReleaseConfig(env).length, 1);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('iOS release accepts the owned update identity without Android credentials and rejects a different owner/project', () => {
    const env = { APP_ENV: 'production', EXPO_PUBLIC_TALOS_SERVER_URL: 'https://api.talosapp.ai', EXPO_PUBLIC_TALOS_WEBAPP_URL: 'https://talosapp.ai' };
    assert.deepEqual(validateReleaseConfig(env, 'ios'), []);
    assert.ok(validateReleaseConfig({ ...env, TALOS_EAS_PROJECT_ID: '11111111-2222-4333-8444-555555555555' }, 'ios').some(error => error.startsWith('TALOS_EAS_PROJECT_ID')));
    assert.ok(validateReleaseConfig({ ...env, TALOS_EXPO_OWNER: 'other-owner' }, 'ios').some(error => error.startsWith('TALOS_EXPO_OWNER')));
    assert.ok(validateReleaseConfig(env, 'typo').length > 0);
});

test('nonproduction variants require an explicit valid project and owner', () => {
    const env = { APP_ENV: 'preview', EXPO_PUBLIC_TALOS_SERVER_URL: 'https://api.talosapp.ai', EXPO_PUBLIC_TALOS_WEBAPP_URL: 'https://talosapp.ai' };
    assert.equal(validateReleaseConfig(env, 'ios').length, 2);
    assert.deepEqual(validateReleaseConfig({ ...env, TALOS_EXPO_OWNER: 'test-owner', TALOS_EAS_PROJECT_ID: '11111111-2222-4333-8444-555555555555' }, 'ios'), []);
});
