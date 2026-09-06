#!/usr/bin/env node
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function runOta(profile, { env = process.env, run = spawnSync } = {}) {
    if (!['preview', 'production'].includes(profile)) throw new Error('OTA profile must be preview or production.');
    if (!env.npm_execpath) throw new Error('Run this command through pnpm ota or pnpm ota:production.');
    const releaseEnv = { ...env, APP_ENV: profile, NODE_ENV: 'production' };
    const options = { cwd: path.resolve(__dirname, '../packages/talos-app'), env: releaseEnv, stdio: 'inherit' };
    const message = env.OTA_MESSAGE || (profile === 'preview' ? 'Preview OTA' : 'Production OTA');
    const steps = [
        [path.join(__dirname, 'verify-release-config.cjs'), 'mobile'],
        [env.npm_execpath, 'exec', 'tsx', 'sources/scripts/parseChangelog.ts'],
        [env.npm_execpath, 'run', 'typecheck'],
        [env.npm_execpath, 'exec', 'eas', 'update', '--branch', profile, '--message', message, '--non-interactive'],
    ];
    for (const args of steps) {
        const result = run(process.execPath, args, options);
        if (result.error) throw result.error;
        if (result.status !== 0) return result.status ?? 1;
    }
    return 0;
}

if (require.main === module) {
    try { process.exitCode = runOta(process.argv[2]); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { runOta };
