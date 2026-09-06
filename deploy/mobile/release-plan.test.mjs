import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { classifyPath } from './release-plan.mjs';

for (const [path, expected] of [
  ['packages/happy-app/sources/components/Chat.tsx', 'ota'],
  ['packages/happy-wire/src/messages.ts', 'ota'],
  ['packages/happy-app/sources/assets/images/icon.png', 'native'],
  ['packages/happy-app/plugins/withEinkCompatibility.js', 'native'],
  ['packages/happy-app/package.json', 'native'],
  ['pnpm-lock.yaml', 'native'],
  ['patches/fix-livekit-room-reuse.cjs', 'native'],
  ['packages/happy-app/app.config.js', 'native'],
  ['packages/happy-app/fingerprint.config.js', 'native'],
  ['packages/happy-app/sources/chat.test.ts', 'none'],
  ['packages/happy-server/src/index.ts', 'none'],
  ['deploy/mobile/Jenkinsfile', 'none'],
  ['AGENTS.md', 'none'],
  ['unknown-native-input', 'native'],
]) test(`${path}: ${expected}`, () => assert.equal(classifyPath(path), expected));

test('real Git ranges: bootstrap, accumulated failure, rename, bad baselines and overrides', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'happy-release-test-'));
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
    const js = commit('packages/happy-app/sources/chat.ts');
    assert.equal(run(base, js), 'ota');
    const native = commit('packages/happy-app/plugins/native.js');
    const docs = commit('docs/README.md');
    assert.equal(run(base, docs), 'native'); // Failed native run is still pending.
    assert.equal(run(native, docs), 'none');
    assert.throws(() => run(base, docs, 'ota'));
    assert.throws(() => run(base, docs, 'none'));
    assert.throws(() => run('', docs, 'none'));
    assert.throws(() => run('deadbeef', docs));
    assert.throws(() => run(docs, base));
    assert.equal(run(base, base, 'native'), 'native');
    git('mv', 'packages/happy-app/sources/chat.ts', 'docs/chat.ts'); git('commit', '-qm', 'rename');
    assert.equal(run(docs, git('rev-parse', 'HEAD')), 'ota');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('submission rejects stale or failed artifacts and extracts only exact finished build', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'happy-build-test-'));
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
