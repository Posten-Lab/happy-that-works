const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
for (const exitCode of [0, 7]) test(`submission restores exact original config after exit ${exitCode}`, () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'talos-submit-test-'));
  const original = JSON.stringify({ build: { production: { channel: 'production', env: { APP_ENV: 'production' } } },
    submit: { production: { ios: { ascAppId: '6787151946' } } } }, null, 4) + '\n';
  const id = '15ce87d9-dcf8-4243-b85e-6268095973bc';
  try {
    fs.writeFileSync(path.join(cwd, 'eas.json'), original);
    fs.writeFileSync(path.join(cwd, 'eas'), '#!/usr/bin/env node\n' + `
      const fs=require('fs');
      fs.writeFileSync('observed.json', JSON.stringify({ args:process.argv.slice(2),config:JSON.parse(fs.readFileSync('eas.json')) }));
      process.exit(${exitCode});\n`, { mode: 0o755 });
    const result = spawnSync('sh', [path.join(__dirname, 'submit-ios.sh'), id], { cwd, encoding: 'utf8',
      env: { ...process.env, PATH: cwd + path.delimiter + process.env.PATH, EXPO_ASC_KEY_ID: 'test-id',
        EXPO_ASC_ISSUER_ID: 'test-issuer', EXPO_ASC_API_KEY_PATH: '/tmp/talos-asc-key.RANDOM123' } });
    assert.equal(result.status, exitCode, result.stderr);
    assert.equal(fs.readFileSync(path.join(cwd, 'eas.json'), 'utf8'), original);
    const observed = JSON.parse(fs.readFileSync(path.join(cwd, 'observed.json')));
    assert.deepEqual(observed.args, ['submit', '-p', 'ios', '--profile', 'production', '--id', id, '--non-interactive', '--wait']);
    assert.deepEqual(observed.config.build, JSON.parse(original).build);
    assert.equal(observed.config.submit.production.ios.ascApiKeyPath, '/tmp/talos-asc-key.RANDOM123');
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});
