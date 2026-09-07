// Runs the installed Expo runtime resolver against real project inputs. No build,
// model request or update is submitted. Every modified source is restored.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const app = path.resolve(__dirname, '../../packages/talos-app');
const req = createRequire(path.join(app, 'package.json'));
const cli = path.join(path.dirname(req.resolve('expo-updates/package.json')), 'bin/cli.js');
const jsFile = path.join(app, 'sources/sync/providerUsage.ts');
const nativeFile = path.join(app, 'plugins/withEinkCompatibility.js');
const originals = new Map([jsFile, nativeFile].map(file => [file, fs.readFileSync(file)]));
const resolve = () => JSON.parse(execFileSync(process.execPath, [cli, 'runtimeversion:resolve', '--platform', 'ios', '--workflow', 'managed'],
  { cwd: app, env: { ...process.env, APP_ENV: 'production' }, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 })).runtimeVersion;
try {
  const baseline = resolve();
  assert.match(baseline, /^[a-f0-9]{40}$/);
  assert.equal(resolve(), baseline, 'Repeated runtime resolution must be deterministic');
  fs.appendFileSync(jsFile, '\n// Temporary OTA compatibility verification.\n');
  assert.equal(resolve(), baseline, 'JavaScript-only edits must retain the native runtime');
  fs.writeFileSync(jsFile, originals.get(jsFile));
  fs.appendFileSync(nativeFile, '\n// Temporary native input verification.\n');
  assert.notEqual(resolve(), baseline, 'Native plugin edits must create a distinct runtime');
  fs.writeFileSync(nativeFile, originals.get(nativeFile));
  assert.equal(resolve(), baseline, 'Restored native inputs must recover the same runtime');
  console.log(JSON.stringify({ verified: true, runtimeVersion: baseline, deterministic: true, javascriptKeepsRuntime: true, nativeChangeGetsNewRuntime: true, sourcesRestored: true }));
} finally { for (const [file, contents] of originals) fs.writeFileSync(file, contents); }
