// Validate real encrypted account settings with the parser shipped before this change.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const esbuild = require('esbuild');
const nacl = require('tweetnacl');
(async () => {
    const env = process.env.TALOS_HOME_DIR;
    assert(env?.includes('/environments/data/envs/'), 'Use an isolated environment');
    const auth = JSON.parse(fs.readFileSync(path.join(env, 'access.key')));
    const url = process.env.TALOS_SERVER_URL; assert.equal(new URL(url).hostname, 'localhost');
    const response = await fetch(url + '/v1/account/settings', { headers: { Authorization: 'Bearer ' + auth.token } }); assert(response.ok);
    const encrypted = (await response.json()).settings;
    const bytes = Buffer.from(encrypted, 'base64');
    const plain = nacl.secretbox.open(bytes.subarray(24), bytes.subarray(0,24), Buffer.from(auth.secret, 'base64')); assert(plain);
    const settings = JSON.parse(Buffer.from(plain).toString());
    assert(settings.workflowLibraryV3?.length, 'First save a mixed-provider workflow through the actual UI');
    const root = process.cwd(), old = process.env.COMPAT_REVISION || '7130fa064cda06c1c0e73faa306dcf38bffffd95';
    const oldFiles = ['packages/talos-app/sources/sync/settings.ts', 'packages/talos-app/sources/agents/agentDefinition.ts', 'packages/talos-wire/src/workflows.ts'];
    const output = '/tmp/talos-provider-old-settings.cjs';
    await esbuild.build({ entryPoints: [oldFiles[0]], bundle: true, platform: 'node', format: 'cjs', outfile: output,
        tsconfig: 'packages/talos-app/tsconfig.json', plugins: [{ name: 'shipped-parser', setup(build) {
            build.onResolve({ filter: /^@ahmadposten\/talos-wire$/ }, () => ({ path: path.join(root, oldFiles[2]) }));
            build.onLoad({ filter: /\.ts$/ }, args => {
                const rel = path.relative(root, args.path);
                if (oldFiles.includes(rel)) return { contents: execFileSync('git', ['show', old + ':' + rel], {encoding:'utf8'}), loader:'ts', resolveDir: path.dirname(args.path) };
            });
        } }] });
    const parser = require(output), parsed = parser.settingsParse(settings);
    for (const key of ['agentLibrary', 'agentLibraryV2', 'workflowLibrary', 'workflowLibraryV2', 'workflowLibraryV3']) {
        const stripLabels = value => JSON.parse(JSON.stringify(value, (k, v) => k === 'modelLabel' ? undefined : v));
        assert.deepEqual(stripLabels(parsed[key]), stripLabels(settings[key] ?? []), key + ' was dropped by the shipped parser');
    }
    const roundtrip = parser.settingsToSyncPayload(parser.applySettings(parsed, { viewInline: !parsed.viewInline }));
    assert.deepEqual(roundtrip.workflowLibraryV3, settings.workflowLibraryV3);
    assert.deepEqual(roundtrip.agentLibraryV2, settings.agentLibraryV2);
    console.log(JSON.stringify({ shippedRevision: old, encryptedAccountRead: true, oldLibrariesPreserved: true, newFieldsPreserved: true, mixedWorkflows: settings.workflowLibraryV3.length }));
})().catch(e => { console.error(e.message); process.exit(1); });
