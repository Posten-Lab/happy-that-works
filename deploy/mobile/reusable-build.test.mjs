import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { reusableBuild } from './reusable-build.mjs';
const runtime = 'a'.repeat(40);
test('real Git retry selects only finished artifacts with unchanged application and native inputs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talos-reuse-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const commit = (file, contents) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), contents);
    git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', file);
    return git('rev-parse', 'HEAD').trim();
  };
  try {
    git('init', '-q');
    const base = commit('packages/talos-app/sources/app.ts', 'original');
    const build = { id: 'eb275718-df2a-4779-9e3f-da96eba575bc', status: 'FINISHED', platform: 'IOS', gitCommitHash: base,
      buildProfile: 'production', distribution: 'STORE', runtimeVersion: runtime, fingerprint: { hash: runtime },
      artifacts: { buildUrl: 'https://example.invalid/build.ipa' } };
    assert.equal(reusableBuild([build], base, runtime, git), build);
    const toolsHead = commit('deploy/mobile/verify-ios-ipa.py', 'fixed verifier');
    assert.equal(reusableBuild([build], toolsHead, runtime, git), build);
    const untracked = path.join(dir, 'packages/talos-app/sources/new.ts');
    fs.writeFileSync(untracked, 'unreviewed source');
    assert.throws(() => reusableBuild([build], toolsHead, runtime, git), /clean reviewed/);
    fs.unlinkSync(untracked);
    for (const change of [{ status: 'ERRORED' }, { platform: 'ANDROID' }, { buildProfile: 'preview' },
      { distribution: 'INTERNAL' }, { fingerprint: { hash: 'b'.repeat(40) } }, { runtimeVersion: 'talos-1' },
      { gitCommitHash: 'f'.repeat(40) }, { artifacts: {} }]) {
      assert.equal(reusableBuild([{ ...build, ...change }], toolsHead, runtime, git), null);
    }
    fs.appendFileSync(path.join(dir, 'deploy/mobile/verify-ios-ipa.py'), 'uncommitted');
    assert.throws(() => reusableBuild([build], toolsHead, runtime, git), /clean reviewed/);
    git('restore', 'deploy/mobile/verify-ios-ipa.py');
    assert.throws(() => reusableBuild([build], base, runtime, git), /clean reviewed/);
    assert.throws(() => reusableBuild({}, toolsHead, runtime, git), /exact checkout/);
    assert.throws(() => reusableBuild([build], toolsHead, 'invalid', git), /exact checkout/);
    for (const file of ['packages/talos-app/sources/app.ts', 'packages/talos-app/plugins/plugin.js', 'pnpm-lock.yaml', '.gitignore', 'unknown.config']) {
      git('reset', '--hard', toolsHead);
      const head = commit(file, 'changed application input');
      assert.equal(reusableBuild([build], head, runtime, git), null, file);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
