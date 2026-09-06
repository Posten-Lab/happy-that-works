const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { prepareImageContext } = require('./prepare-image-context.cjs');

function fixture(t) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'talos-context-test-')));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    git(['init', '-q']);
    git(['config', 'user.name', 'Talos context test']);
    git(['config', 'user.email', 'context-test@talosapp.ai']);
    fs.mkdirSync(path.join(root, 'packages/talos-wire'), { recursive: true });
    fs.writeFileSync(path.join(root, 'packages/talos-wire/source.ts'), 'export const source = "committed";\n');
    fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n');
    git(['add', '.']); git(['commit', '-qm', 'context fixture']);
    return { root, git, revision: git(['rev-parse', 'HEAD']) };
}

test('archives committed source while excluding ignored install shims and untracked test output', t => {
    const { root, revision } = fixture(t);
    const shim = 'packages/talos-wire/node_modules/.bin/shx';
    fs.mkdirSync(path.dirname(path.join(root, shim)), { recursive: true });
    fs.writeFileSync(path.join(root, shim), 'isolated-install-shim');
    fs.writeFileSync(path.join(root, 'generated-test-output.json'), '{}');
    const directory = prepareImageContext(root, revision);
    assert.equal(fs.readFileSync(path.join(directory, 'packages/talos-wire/source.ts'), 'utf8'), 'export const source = "committed";\n');
    assert.equal(fs.existsSync(path.join(directory, shim)), false);
    assert.equal(fs.existsSync(path.join(directory, 'generated-test-output.json')), false);
    assert.equal(fs.existsSync(path.join(directory, '.git')), false);
    assert.equal(fs.existsSync(`${directory}.tar`), false);
    assert.equal(fs.readFileSync(path.join(root, shim), 'utf8'), 'isolated-install-shim');
    assert.notEqual(prepareImageContext(root, revision), directory);
});

test('rejects ambiguous or different revisions and uncommitted tracked changes', t => {
    const { root, revision } = fixture(t);
    for (const bad of ['main', '--all', 'a'.repeat(40)]) assert.throws(() => prepareImageContext(root, bad), /revision|checkout/);
    fs.writeFileSync(path.join(root, 'packages/talos-wire/source.ts'), 'unreviewed-change');
    assert.throws(() => prepareImageContext(root, revision), /Tracked checkout changes/);
});

test('rejects a package subdirectory instead of the verified repository root', t => {
    const { root, revision } = fixture(t);
    assert.throws(() => prepareImageContext(path.join(root, 'packages/talos-wire'), revision), /checkout root/);
});
