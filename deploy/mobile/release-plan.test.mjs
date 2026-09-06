import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { classifyPath } from './release-plan.mjs';

for (const [path, expected] of [
  ['packages/talos-app/sources/components/Chat.tsx', 'ota'],
  ['packages/talos-wire/src/messages.ts', 'ota'],
  ['packages/talos-app/sources/assets/images/icon.png', 'native'],
  ['packages/talos-app/plugins/withEinkCompatibility.js', 'native'],
  ['packages/talos-app/package.json', 'native'],
  ['pnpm-lock.yaml', 'native'],
  ['patches/fix-livekit-room-reuse.cjs', 'native'],
  ['packages/talos-app/app.config.js', 'native'],
  ['packages/talos-app/fingerprint.config.js', 'native'],
  ['packages/talos-app/sources/chat.test.ts', 'none'],
  ['packages/talos-server/src/index.ts', 'none'],
  ['deploy/mobile/Jenkinsfile', 'none'],
  ['AGENTS.md', 'none'],
  ['unknown-native-input', 'native'],
]) test(`${path}: ${expected}`, () => assert.equal(classifyPath(path), expected));

test('real Git ranges: bootstrap, accumulated failure, rename, bad baselines and overrides', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'talos-release-test-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const selector = new URL('./release-plan.mjs', import.meta.url).pathname;
  const run = (base, head, mode = 'auto') => execFileSync(process.execPath, [selector, base, head, mode],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commit = (path) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), Math.random().toString());
    git('add', '.'); git('commit', '-qm', path); return git('rev-parse', 'HEAD');
  };
  try {
    git('init', '-q'); git('config', 'user.name', 'CI test'); git('config', 'user.email', 'ci@example.invalid');
    const base = commit('README.md');
    assert.equal(run('', base), 'native');
    assert.equal(run(base, base), 'none');
    const js = commit('packages/talos-app/sources/chat.ts');
    assert.equal(run(base, js), 'ota');
    const native = commit('packages/talos-app/plugins/native.js');
    const docs = commit('docs/README.md');
    assert.equal(run(base, docs), 'native'); // Failed native run is still pending.
    assert.equal(run(native, docs), 'none');
    assert.throws(() => run(base, docs, 'ota'));
    assert.throws(() => run(base, docs, 'none'));
    assert.throws(() => run('', docs, 'none'));
    assert.throws(() => run('deadbeef', docs));
    assert.throws(() => run(docs, base));
    assert.equal(run(base, base, 'native'), 'native');
    git('mv', 'packages/talos-app/sources/chat.ts', 'docs/chat.ts'); git('commit', '-qm', 'rename');
    assert.equal(run(docs, git('rev-parse', 'HEAD')), 'ota');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('server and web image changes skip mobile delivery without hiding bundled or native changes', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'talos-image-release-test-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const selector = new URL('./release-plan.mjs', import.meta.url).pathname;
  const run = (base, head) => execFileSync(process.execPath, [selector, base, head, 'auto'],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commit = (path) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), `fixture for ${path}\n`);
    git('add', '.'); git('commit', '-qm', path); return git('rev-parse', 'HEAD');
  };
  try {
    git('init', '-q'); git('config', 'user.name', 'CI test'); git('config', 'user.email', 'ci@example.invalid');
    const base = commit('README.md');
    const server = commit('Dockerfile.server');
    assert.equal(run(base, server), 'none');
    const web = commit('Dockerfile.webapp');
    assert.equal(run(base, web), 'none');
    const bundled = commit('packages/talos-app/sources/session.ts');
    assert.equal(run(base, bundled), 'ota');
    const native = commit('packages/talos-app/plugins/notification.js');
    assert.equal(run(base, native), 'native');
    const unknown = commit('Dockerfile.mobile');
    assert.equal(run(native, unknown), 'native');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('submission rejects stale or failed artifacts and extracts only exact finished build', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'talos-build-test-'));
  const file = join(cwd, 'build.json');
  const build = { id: '15ce87d9-dcf8-4243-b85e-6268095973bc', status: 'FINISHED', platform: 'IOS',
    gitCommitHash: 'a'.repeat(40), buildProfile: 'production', distribution: 'STORE' };
  const run = value => {
    writeFileSync(file, JSON.stringify(value));
    return execFileSync(process.execPath, [new URL('./build-id.cjs', import.meta.url).pathname, file],
      { encoding: 'utf8', env: { ...process.env, GIT_COMMIT: build.gitCommitHash }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  };
  try {
    assert.equal(run([build]), build.id);
    for (const bad of [{ ...build, status: 'ERRORED' }, { ...build, gitCommitHash: 'b'.repeat(40) },
      { ...build, platform: 'ANDROID' }, { ...build, buildProfile: 'preview' }, [build, build]]) {
      assert.throws(() => run(bad));
    }
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('runtime compatibility requires an exact finished production binary', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'talos-runtime-test-'));
  const hash = 'a'.repeat(40);
  const build = { status: 'FINISHED', platform: 'IOS', buildProfile: 'production', distribution: 'STORE', runtimeVersion: 'talos-1', fingerprint: { hash } };
  const run = builds => {
    writeFileSync(join(cwd, 'compatible-builds.json'), JSON.stringify(builds));
    return execFileSync(process.execPath, [new URL('./compatible-runtime.cjs', import.meta.url).pathname],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  };
  try {
    writeFileSync(join(cwd, 'fingerprint-result.json'), JSON.stringify({ hash }));
    writeFileSync(join(cwd, 'runtime-config.json'), JSON.stringify({ runtimeVersion: 'talos-1', extra: { eas: { projectId: '4445e993-5eaa-4a1a-8754-7068e8565e64' } } }));
    assert.equal(run([build]), 'yes');
    for (const builds of [[], [{ ...build, status: 'CANCELED' }], [{ ...build, runtimeVersion: '21' }],
      [{ ...build, buildProfile: 'preview' }], [{ ...build, distribution: 'INTERNAL' }]]) {
      assert.equal(run(builds), 'no');
    }
    assert.equal(run([{ ...build, fingerprint: undefined }]), 'no');
    assert.equal(run([{ ...build, fingerprint: { hash: 'b'.repeat(40) } }]), 'no');
    assert.equal(run([build, { ...build, fingerprint: { hash: 'b'.repeat(40) } }]), 'no');
    assert.equal(run(Array.from({ length: 50 }, () => build)), 'no');
    assert.throws(() => run({ error: 'EAS unavailable' }));
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('submit configuration uses Jenkins credential IDs without changing build settings', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'talos-submit-test-'));
  try {
    const config = { build: { production: { channel: 'production' } },
      submit: { production: { ios: { ascAppId: '6787151946' } } } };
    writeFileSync(join(cwd, 'eas.json'), JSON.stringify(config));
    execFileSync(process.execPath, [new URL('./prepare-submit.cjs', import.meta.url).pathname],
      { cwd, env: { ...process.env, EXPO_ASC_KEY_ID: 'test-id', EXPO_ASC_ISSUER_ID: 'test-issuer', EXPO_ASC_API_KEY_PATH: '/tmp/talos-asc-key.TEST123' } });
    const result = JSON.parse(readFileSync(join(cwd, 'eas.json'), 'utf8'));
    assert.deepEqual(result.build, config.build);
    assert.equal(result.submit.production.ios.ascAppId, '6787151946');
    assert.equal(result.submit.production.ios.ascApiKeyId, 'test-id');
    assert.equal(result.submit.production.ios.ascApiKeyIssuerId, 'test-issuer');
    assert.equal(result.submit.production.ios.ascApiKeyPath, '/tmp/talos-asc-key.TEST123');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
