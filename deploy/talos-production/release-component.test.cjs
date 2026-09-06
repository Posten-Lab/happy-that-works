const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { release, configFor, desiredTemplate, components } = require('./release-component.cjs');
const template = JSON.parse(fs.readFileSync(path.join(__dirname, 'workloads.template.json'), 'utf8'));
const sha = 'a'.repeat(40);
const oldImage = `ahmadposten/talos-server@sha256:${'1'.repeat(64)}`;
const image = `ahmadposten/talos-server@sha256:${'2'.repeat(64)}`;
const clone = value => JSON.parse(JSON.stringify(value));

function fixture() {
    let current = clone(template.items.find(item => item.kind === 'Deployment' && item.metadata.name === 'talos-api'));
    current.metadata.resourceVersion = '10';
    current.spec.template.spec.containers[0].image = oldImage;
    const before = clone(current);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'talos-release-'));
    const calls = [];
    let failRollout = false;
    const run = args => {
        calls.push(args);
        assert.equal(args[0], '-n'); assert.equal(args[1], 'happy');
        if (args[2] === 'get') return JSON.stringify(current);
        if (args[2] === 'patch') {
            assert.equal(args[3], 'deployment'); assert.equal(args[4], 'talos-api');
            const patch = JSON.parse(args[args.indexOf('-p') + 1]);
            assert.equal(patch.length, 3);
            assert.equal(patch[0].value, current.metadata.resourceVersion);
            assert.deepEqual(patch[1].value, current.spec.template);
            assert.equal(patch[2].path, '/spec/template');
            current.spec.template = clone(patch[2].value);
            current.metadata.resourceVersion = String(Number(current.metadata.resourceVersion) + 1);
            return JSON.stringify(current);
        }
        if (args[2] === 'rollout') {
            if (failRollout) { failRollout = false; throw Error('readiness timeout'); }
            return 'rolled out';
        }
        throw Error(`Unexpected mutation: ${args.join(' ')}`);
    };
    return {
        before, directory, calls, run, options: { component: 'api', image, revision: sha, directory },
        get current() { return current; },
        set failRollout(value) { failRollout = value; },
        cleanup() { fs.rmSync(directory, { recursive: true, force: true }); },
    };
}

test('rejects mutable images, wrong repositories and ambiguous revisions', () => {
    for (const bad of ['ahmadposten/talos-server:latest', oldImage.replace('server', 'web'), oldImage.replace('talos', 'happy')]) {
        assert.throws(() => configFor('api', bad, sha));
    }
    assert.throws(() => configFor('api', image, 'main'));
    assert.throws(() => configFor('postgres', image, sha));
});

test('preserves infrastructure, scheduling, probes and secret references', () => {
    const f = fixture();
    try {
        const after = desiredTemplate(f.before, components.api, image, sha);
        const normalized = clone(after);
        normalized.spec.containers[0].image = oldImage;
        normalized.spec.containers[0].env = normalized.spec.containers[0].env.filter(item => item.name !== 'GIT_SHA');
        delete normalized.metadata.annotations['talosapp.ai/git-sha'];
        if (!Object.keys(normalized.metadata.annotations).length && !f.before.spec.template.metadata.annotations) delete normalized.metadata.annotations;
        assert.deepEqual(normalized, f.before.spec.template);
    } finally { f.cleanup(); }
});

test('does not snapshot inline secrets or mutate a previous product deployment', () => {
    const f = fixture();
    try {
        f.before.spec.template.spec.containers[0].env.push({ name: 'DATABASE_PASSWORD', value: 'test-value' });
        assert.throws(() => desiredTemplate(f.before, components.api, image, sha), /Inline credentials/);
        f.before.metadata.name = 'happy-server';
        assert.throws(() => desiredTemplate(f.before, components.api, image, sha), /identity/);
    } finally { f.cleanup(); }
});

test('successful rollout checks the exact public revision and writes private receipts', async () => {
    const f = fixture(); const healthChecks = [];
    try {
        const result = await release(f.options, { run: f.run, health: async (_config, revision) => healthChecks.push(revision) });
        assert.equal(result.status, 'deployed'); assert.deepEqual(healthChecks, [sha]);
        assert.equal(f.calls.filter(args => args[2] === 'patch').length, 1);
        assert.equal(fs.statSync(path.join(f.directory, 'previous.json')).mode & 0o777, 0o600);
        assert.deepEqual(f.current.spec.template.spec.containers[0].envFrom, f.before.spec.template.spec.containers[0].envFrom);
    } finally { f.cleanup(); }
});

test('public failure restores only the exact previous component template', async () => {
    const f = fixture();
    try {
        await assert.rejects(release(f.options, { run: f.run, sleep: async () => {}, health: async (_config, revision) => {
            if (revision === sha) throw Error('wrong public revision');
        } }), /previous Talos component restored/);
        assert.deepEqual(f.current.spec, f.before.spec);
        assert.equal(f.calls.filter(args => args[2] === 'patch').length, 2);
        assert.equal(JSON.parse(fs.readFileSync(path.join(f.directory, 'release.json'))).status, 'rolled-back');
    } finally { f.cleanup(); }
});

test('readiness timeout also restores the previous component', async () => {
    const f = fixture(); f.failRollout = true;
    try {
        await assert.rejects(release(f.options, { run: f.run, health: async () => {} }), /readiness timeout/);
        assert.deepEqual(f.current.spec, f.before.spec);
    } finally { f.cleanup(); }
});

test('concurrent operator change is preserved instead of rolled back', async () => {
    const f = fixture();
    try {
        await assert.rejects(release(f.options, { run: f.run, sleep: async () => {}, health: async () => {
            f.current.spec.template.metadata.annotations['operator-change'] = 'preserve';
            throw Error('unavailable');
        } }), /Another operator changed/);
        assert.equal(f.calls.filter(args => args[2] === 'patch').length, 1);
        assert.equal(f.current.spec.template.metadata.annotations['operator-change'], 'preserve');
        assert.equal(JSON.parse(fs.readFileSync(path.join(f.directory, 'release.json'))).status, 'rollback-refused');
    } finally { f.cleanup(); }
});

test('optimistic-lock failure leaves the original deployment unchanged', async () => {
    const f = fixture();
    try {
        await assert.rejects(release(f.options, { run: args => {
            if (args[2] === 'patch') throw Error('resourceVersion conflict');
            return f.run(args);
        }, health: async () => {} }), /resourceVersion conflict/);
        assert.deepEqual(f.current.spec, f.before.spec);
        assert.equal(JSON.parse(fs.readFileSync(path.join(f.directory, 'release.json'))).status, 'unchanged');
    } finally { f.cleanup(); }
});

test('Jenkins recovery is idempotent and refuses mismatched receipts', async () => {
    const f = fixture();
    try {
        const deps = { run: f.run, health: async () => {} };
        await release(f.options, deps);
        const receiptPath = path.join(f.directory, 'release.json');
        const receipt = JSON.parse(fs.readFileSync(receiptPath)); receipt.status = 'pending';
        fs.writeFileSync(receiptPath, JSON.stringify(receipt));
        assert.equal((await release({ ...f.options, recover: true }, deps)).status, 'rolled-back');
        assert.equal((await release({ ...f.options, recover: true }, deps)).status, 'rolled-back');
        assert.equal(f.calls.filter(args => args[2] === 'patch').length, 2);
        await assert.rejects(release({ ...f.options, revision: 'b'.repeat(40), recover: true }, deps), /Receipt identity/);
    } finally { f.cleanup(); }
});
