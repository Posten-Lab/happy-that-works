const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nativeRuntime } = require('./runtime-version.cjs');
const { verifiedBuild } = require('./build-id.cjs');
const hash = 'a'.repeat(40);
const config = { runtimeVersion: { policy: 'fingerprint' }, extra: { eas: { projectId: '4445e993-5eaa-4a1a-8754-7068e8565e64' } } };
test('requires fingerprint policy and the owned EAS project; refuses ambiguous legacy runtimes', () => {
  assert.equal(nativeRuntime({ hash }, config), hash);
  for (const runtimeVersion of ['talos-1', { policy: 'appVersion' }, undefined]) {
    assert.throws(() => nativeRuntime({ hash }, { ...config, runtimeVersion }));
  }
  assert.throws(() => nativeRuntime({ hash }, { ...config, extra: {} }));
  assert.throws(() => nativeRuntime({ hash: 'invalid' }, config));
});
test('verifies the finished native build against the pre-build fingerprint', () => {
  const b = { id: '15ce87d9-dcf8-4243-b85e-6268095973bc', status: 'FINISHED', platform: 'IOS',
    gitCommitHash: 'b'.repeat(40), buildProfile: 'production', distribution: 'STORE', runtimeVersion: hash, fingerprint: { hash } };
  assert.equal(verifiedBuild(b, b.gitCommitHash, hash).id, b.id);
  for (const change of [{ runtimeVersion: 'talos-1' }, { fingerprint: { hash: 'c'.repeat(40) } }, { fingerprint: null }]) {
    assert.throws(() => verifiedBuild({ ...b, ...change }, b.gitCommitHash, hash));
  }
});
