const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const appDirectory = path.resolve(__dirname, '../packages/talos-app');

function loadConfig(env) {
    const filename = path.join(appDirectory, 'app.config.js');
    const module = { exports: {} };
    const script = fs.readFileSync(filename, 'utf8').replace('export default', 'module.exports =');
    vm.runInNewContext(script, { module, require: createRequire(filename), process: { env }, URL }, { filename });
    return JSON.parse(JSON.stringify(module.exports.expo));
}

test('production updates the installed app while every visible identity uses Talos', () => {
    const app = loadConfig({ APP_ENV: 'production', EXPO_PUBLIC_TALOS_WEBAPP_URL: 'https://talosapp.ai' });
    assert.equal(app.name, 'Talos');
    assert.equal(app.slug, 'happy-improved');
    assert.equal(app.version, '2.0.0');
    assert.equal(app.version, JSON.parse(fs.readFileSync(path.join(appDirectory, 'package.json'), 'utf8')).version);
    assert.equal(app.ios.bundleIdentifier, 'com.ahposten.happyimproved');
    assert.equal(app.android.package, 'com.ahposten.happyimproved');
    assert.equal(app.ios.appleTeamId, 'H2XR8XWZXW');
    assert.deepEqual(app.scheme, ['talos', 'happy']);
    assert.deepEqual(app.runtimeVersion, { policy: 'fingerprint' });
    assert.notEqual(app.runtimeVersion, '21');
    assert.equal(app.extra.eas.projectId, '4445e993-5eaa-4a1a-8754-7068e8565e64');
    assert.equal(app.updates.url, 'https://u.expo.dev/4445e993-5eaa-4a1a-8754-7068e8565e64');
    assert.equal(app.owner, 'posten-lab');
    // Existing default keychain access and SecureStore plugin remain intact.
    assert.equal(app.ios.entitlements?.['keychain-access-groups'], undefined);
    assert.equal(app.ios.associatedDomains, undefined);
    assert.ok(app.plugins.includes('expo-secure-store'));
    assert.equal(app.icon, './sources/assets/images/icon.png');
});

test('development and preview retain separate installs without claiming production deep links', () => {
    for (const [variant, suffix] of [['development', 'dev'], ['preview', 'preview']]) {
        const app = loadConfig({ APP_ENV: variant });
        assert.equal(app.ios.bundleIdentifier, `com.ahposten.talos.${suffix}`);
        assert.equal(app.android.package, `com.ahposten.talos.${suffix}`);
        assert.equal(app.scheme, 'talos');
        assert.equal(app.updates.enabled, false);
    }
});

test('production config itself refuses foreign project overrides even without preflight', () => {
    assert.throws(() => loadConfig({ APP_ENV: 'production', TALOS_EXPO_OWNER: 'foreign-owner' }), /existing owned store project/);
    assert.throws(() => loadConfig({ APP_ENV: 'production', TALOS_EAS_PROJECT_ID: '11111111-2222-4333-8444-555555555555' }), /existing owned store project/);
    assert.throws(() => loadConfig({ APP_ENV: 'prodution' }), /APP_ENV/);
});

test('submission targets the existing listing with a monotonically increasing remote build number', () => {
    const eas = JSON.parse(fs.readFileSync(path.join(appDirectory, 'eas.json'), 'utf8'));
    assert.equal(eas.submit.production.ios.ascAppId, '6787151946');
    assert.equal(eas.submit.production.ios.appleTeamId, 'H2XR8XWZXW');
    assert.equal(eas.cli.appVersionSource, 'remote');
    assert.equal(eas.build.production.autoIncrement, true);
    assert.equal(eas.build.production.env.APP_ENV, 'production');
    assert.equal(eas.build.production.env.NPM_CONFIG_NODE_LINKER, 'isolated');
    assert.equal(eas.build.production.env.NPM_CONFIG_SHAMEFULLY_HOIST, 'false');
    assert.equal(eas.build.production.environment, 'production');
});

test('native fingerprint ignores commit labels but retains native compatibility inputs', () => {
    const { fileHookTransform } = require('../packages/talos-app/fingerprint.config.js');
    const source = { type: 'contents', id: 'expoConfig' };
    const config = { runtimeVersion: 'talos-1', ios: { bundleIdentifier: 'com.ahposten.happyimproved' },
        extra: { app: { buildCommitSha: 'old', buildCommitTimestamp: 'old-time', featureFlag: true } } };
    const transformed = JSON.parse(fileHookTransform(source, JSON.stringify(config)));
    assert.deepEqual(transformed.extra.app, { featureFlag: true });
    assert.equal(transformed.runtimeVersion, config.runtimeVersion);
    assert.deepEqual(transformed.ios, config.ios);
    const changedCommit = { ...config, extra: { app: { ...config.extra.app, buildCommitSha: 'new' } } };
    assert.equal(fileHookTransform(source, JSON.stringify(config)), fileHookTransform(source, JSON.stringify(changedCommit)));
    assert.notEqual(fileHookTransform(source, JSON.stringify(config)), fileHookTransform(source, JSON.stringify({ ...config, runtimeVersion: 'talos-2' })));
    assert.equal(fileHookTransform({ type: 'file', id: 'other' }, 'untouched'), 'untouched');
});

// Regression: build 20 lost production deep links because these values existed
// only in Jenkins, changing the runtime when EAS evaluated app.config.js.
test('EAS production worker retains the same native config as the release runner', () => {
    const profile = JSON.parse(fs.readFileSync(path.join(appDirectory, 'eas.json'), 'utf8')).build.production.env;
    const pipeline = fs.readFileSync(path.join(__dirname, '../deploy/mobile/Jenkinsfile'), 'utf8');
    const runner = { APP_ENV: 'production' };
    for (const [, key, value] of pipeline.matchAll(/(EXPO_PUBLIC_TALOS_\w+) = '([^']+)'/g)) runner[key] = value;
    for (const [key, value] of Object.entries(runner)) assert.equal(profile[key], value, `${key} must reach EAS`);
    assert.deepEqual(loadConfig(profile), loadConfig(runner));
    assert.ok(loadConfig(profile).android.intentFilters.length > 0);
});
