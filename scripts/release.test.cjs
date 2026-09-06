const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseArgs, releasePlan, runRelease, registry } = require('./release.cjs');
const root = path.resolve(__dirname, '..');

function mockRegistry({ owner = 'ahmadposten', published = [], failPublish = false, registryError, wireTestFailure = false } = {}) {
    const versions = new Set(published); const calls = [];
    const run = (command, args, options) => {
        calls.push({ command, args, options });
        if (command === 'npm' && args[0] === 'whoami') return { status: 0, stdout: owner };
        if (command === 'bun') return { status: 0, stdout: '1.4.2' };
        if (command === 'npm' && args[0] === 'view') {
            if (registryError) return { status: 1, stdout: JSON.stringify({ error: { code: registryError } }) };
            return versions.has(args[1]) ? { status: 0, stdout: JSON.stringify(args[1].slice(args[1].lastIndexOf('@') + 1)) }
                : { status: 1, stdout: JSON.stringify({ error: { code: 'E404' } }) };
        }
        if (command === 'pnpm' && args[0] === '--filter') return { status: wireTestFailure ? 1 : 0 };
        if (command === 'pnpm' && args[0] === 'publish') {
            if (failPublish) return { status: 1 };
            const pkg = JSON.parse(fs.readFileSync(path.join(options.cwd, 'package.json')));
            versions.add(`${pkg.name}@${pkg.version}`); return { status: 0 };
        }
        throw Error(`Unexpected command ${command}`);
    };
    return { run, calls, versions, log() {}, env: { APP_ENV: 'production' } };
}

test('default and dry-run are plans with explicit package identities and dependency order', () => {
    assert.deepEqual(releasePlan(parseArgs([])).map(item => item.id), ['wire', 'server', 'agent', 'cli']);
    for (const args of [[], ['all'], ['wire', '--plan'], ['--', 'cli', '--dry-run']]) {
        const state = mockRegistry(); runRelease(parseArgs(args), state); assert.equal(state.calls.length, 0);
    }
});

test('rejects unknown flags, targets, duplicate options and conflicting publication modes', () => {
    for (const args of [['mobile'], ['cli', 'wire'], ['cli', '--ignore-scripts'], ['all', '--publish', '--dry-run'],
        ['all', '--publish', '--help'], ['--tag'], ['--tag', '--publish'], ['--tag', '1.0.0'], ['--publish', '--publish']]) {
        assert.throws(() => parseArgs(args));
    }
    assert.equal(parseArgs(['cli', '--publish', '--tag', 'next']).tag, 'next');
});

test('actual command produces a plan even with no package manager on PATH', () => {
    const result = spawnSync(process.execPath, [path.join(__dirname, 'release.cjs'), 'all', '--dry-run'],
        { env: { ...process.env, PATH: '/nonexistent' }, encoding: 'utf8' });
    assert.equal(result.status, 0); assert.equal(JSON.parse(result.stdout).mode, 'plan');
    assert.equal(JSON.parse(result.stdout).packages[3].name, 'talosapp');
});

test('all publishes wire before server, agent and CLI; no git or release-it commands run', () => {
    const state = mockRegistry(); runRelease(parseArgs(['all', '--publish']), state);
    const publishes = state.calls.filter(call => call.args[0] === 'publish');
    assert.deepEqual(publishes.map(call => path.basename(call.options.cwd)), ['talos-wire', 'talos-server', 'talos-agent', 'talos-cli']);
    for (const call of publishes) {
        assert.equal(call.command, 'pnpm');
        assert.deepEqual(call.args, ['publish', '--access', 'public', '--tag', 'latest', '--no-git-checks', '--registry', registry]);
    }
    assert.ok(state.calls.every(call => ['npm', 'pnpm', 'bun'].includes(call.command)));
});

test('wrong publisher and failed registry reads cannot reach an upload', () => {
    for (const state of [mockRegistry({ owner: 'other-owner' }), mockRegistry({ registryError: 'E403' })]) {
        assert.throws(() => runRelease(parseArgs(['wire', '--publish']), state));
        assert.equal(state.calls.filter(call => call.args[0] === 'publish').length, 0);
    }
});

test('an existing immutable version is refused rather than skipped or overwritten', () => {
    const state = mockRegistry({ published: ['@ahmadposten/talos-wire@0.1.0'] });
    assert.throws(() => runRelease(parseArgs(['wire', '--publish']), state), /already published/);
    assert.equal(state.calls.filter(call => call.args[0] === 'publish').length, 0);
});

test('consumer release requires the current published wire version and passing local wire tests', () => {
    const missing = mockRegistry();
    assert.throws(() => runRelease(parseArgs(['cli', '--publish']), missing), /wire package before/);
    const failing = mockRegistry({ published: ['@ahmadposten/talos-wire@0.1.0'], wireTestFailure: true });
    assert.throws(() => runRelease(parseArgs(['cli', '--publish']), failing), /Wire checks failed/);
    assert.equal(failing.calls.filter(call => call.args[0] === 'publish').length, 0);
    const passing = mockRegistry({ published: ['@ahmadposten/talos-wire@0.1.0'] });
    runRelease(parseArgs(['cli', '--publish']), passing);
    assert.ok(passing.calls.findIndex(call => call.args[0] === '--filter') < passing.calls.findIndex(call => call.args[0] === 'publish'));
});

test('an upload failure is not retried and stops dependent package publication', () => {
    const state = mockRegistry({ failPublish: true });
    assert.throws(() => runRelease(parseArgs(['all', '--publish']), state), /Check registry metadata/);
    assert.equal(state.calls.filter(call => call.args[0] === 'publish').length, 1);
});

test('all server prerequisites are checked before publishing wire', () => {
    const state = mockRegistry(); state.env = {};
    assert.throws(() => runRelease(parseArgs(['all', '--publish']), state), /APP_ENV=production/);
    assert.equal(state.calls.filter(call => call.args[0] === 'publish').length, 0);
});

test('inherited ignore-scripts and dry-run settings cannot bypass prepublish or simulate upload', () => {
    const state = mockRegistry(); state.env = { npm_config_ignore_scripts: 'true', NPM_CONFIG_DRY_RUN: 'true' };
    runRelease(parseArgs(['wire', '--publish', '--tag', 'next']), state);
    const call = state.calls.find(call => call.args[0] === 'publish');
    assert.equal(call.options.env.npm_config_ignore_scripts, 'false');
    assert.equal(call.options.env.NPM_CONFIG_IGNORE_SCRIPTS, 'false');
    assert.equal(call.options.env.NPM_CONFIG_DRY_RUN, 'false');
    assert.equal(call.args[call.args.indexOf('--tag') + 1], 'next');
});

test('package identity, privacy, hooks and registry are validated without executing scripts', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'talos-release-config-'));
    const folder = path.join(temporary, 'packages/talos-wire'); fs.mkdirSync(folder, { recursive: true });
    const original = JSON.parse(fs.readFileSync(path.join(root, 'packages/talos-wire/package.json')));
    try {
        for (const change of [{ private: true }, { name: 'unrelated' }, { version: 'main' }, { scripts: {} }, { publishConfig: { registry: 'https://example.invalid' } }]) {
            fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ ...original, ...change }));
            assert.throws(() => releasePlan(parseArgs(['wire']), temporary));
        }
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test('wire and agent release scripts dispatch directly to fixed root targets', () => {
    for (const target of ['wire', 'agent']) {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, `packages/talos-${target}/package.json`)));
        assert.equal(pkg.scripts.release, `node ../../scripts/release.cjs ${target}`);
    }
});
