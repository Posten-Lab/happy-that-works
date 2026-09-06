const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { downloadArtifact } = require('./download-ios-artifact.cjs');

const commit = 'a'.repeat(40);
const build = { id: '15ce87d9-dcf8-4243-b85e-6268095973bc', status: 'FINISHED', platform: 'IOS',
  gitCommitHash: commit, buildProfile: 'production', distribution: 'STORE',
  artifacts: { buildUrl: 'https://expo.dev/artifact?signature=private-test-value' } };

async function fixture(run) {
  const directory = await fs.mkdtemp(join(tmpdir(), 'talos-artifact-test-'));
  try { await run(join(directory, 'verified.ipa')); } finally { await fs.rm(directory, { recursive: true, force: true }); }
}

test('downloads only the exact completed build to a private file through HTTPS redirects', () => fixture(async target => {
  const requests = [];
  const result = await downloadArtifact([build], target, commit, { fetch: async url => {
    requests.push(url.href);
    return requests.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://cdn.example.test/verified.ipa' } }) : new Response('ipa-content');
  } });
  assert.equal(result.buildId, build.id);
  assert.equal(result.bytes, 11);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.equal(await fs.readFile(target, 'utf8'), 'ipa-content');
  assert.equal((await fs.stat(target)).mode & 0o777, 0o600);
  assert.equal(requests.length, 2);
}));

test('rejects stale, ambiguous, unsuccessful or missing build artifacts before network access', () => fixture(async target => {
  const values = [[build, build], { ...build, gitCommitHash: 'b'.repeat(40) }, { ...build, status: 'ERRORED' },
    { ...build, distribution: 'INTERNAL' }, { ...build, artifacts: {} }];
  for (const value of values) await assert.rejects(downloadArtifact(value, target, commit, { fetch: () => assert.fail('Network must not be called') }));
  await assert.rejects(fs.stat(target), { code: 'ENOENT' });
}));

test('rejects plaintext URLs and redirects and never exposes signed URL errors', () => fixture(async target => {
  await assert.rejects(downloadArtifact({ ...build, artifacts: { buildUrl: 'http://expo.dev/artifact' } }, target, commit));
  for (const response of [() => new Response(null, { status: 302, headers: { location: 'http://cdn.example.test/ipa' } }),
    () => { throw Error(build.artifacts.buildUrl); }]) {
    await assert.rejects(downloadArtifact(build, target, commit, { fetch: async () => response() }), error => !error.message.includes('private-test-value'));
  }
}));

test('bounds redirects, non-success responses, declared sizes and streamed sizes', () => fixture(async target => {
  for (const response of [() => new Response(null, { status: 302, headers: { location: build.artifacts.buildUrl } }),
    () => new Response('error', { status: 403 }), () => new Response('large', { headers: { 'content-length': '500' } }),
    () => new Response('large'), () => new Response('')]) {
    await assert.rejects(downloadArtifact(build, target, commit, { fetch: async () => response(), maxBytes: 4 }));
    await assert.rejects(fs.stat(target), { code: 'ENOENT' });
  }
}));

test('does not overwrite or remove an existing artifact', () => fixture(async target => {
  await fs.writeFile(target, 'preserved');
  await assert.rejects(downloadArtifact(build, target, commit, { fetch: async () => new Response('replacement') }));
  assert.equal(await fs.readFile(target, 'utf8'), 'preserved');
}));
