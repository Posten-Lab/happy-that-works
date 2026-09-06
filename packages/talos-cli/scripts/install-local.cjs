#!/usr/bin/env node

/**
 * Install this workspace as the global `talos` binary for local development.
 *
 * Steps:
 *   1. build
 *   2. stop any running daemon (ignores failure)
 *   3. npm link (replaces the globally-installed `talos` with a symlink to this workspace)
 *   4. start the daemon again
 *   5. verify by running `talos --version`
 *
 * Reuses ~/.talos/ — no separate dev home dir. Auth and sessions carry over.
 * To undo: `npm unlink -g talosapp`.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const PACKAGE_DIR = path.resolve(__dirname, '..');
const IS_WINDOWS = process.platform === 'win32';

function sanitizeLifecyclePath(pathValue) {
    if (!pathValue) return pathValue;

    return pathValue
        .split(path.delimiter)
        .filter((entry) => {
            const normalized = entry.replace(/\\/g, '/').replace(/\/+$/, '');
            return !normalized.endsWith('/node_modules/.bin')
                && !normalized.endsWith('/node-gyp-bin');
        })
        .join(path.delimiter);
}

function daemonEnvironment(source = process.env) {
    const env = { ...source };
    const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'PATH';
    env[pathKey] = sanitizeLifecyclePath(env[pathKey]);
    return env;
}

function run(cmd, args, { allowFailure = false, env = process.env } = {}) {
    const label = [cmd, ...args].join(' ');
    console.log(`\n▶ ${label}`);
    const result = spawnSync(cmd, args, {
        cwd: PACKAGE_DIR,
        stdio: 'inherit',
        env,
        // shell: true resolves `.cmd` shims on Windows so `pnpm` / `npm` / `talos` are found.
        shell: IS_WINDOWS,
    });
    if (result.error) {
        console.error(`Failed to spawn: ${label}`, result.error.message);
        if (!allowFailure) process.exit(1);
        return 1;
    }
    const status = result.status ?? 1;
    if (status !== 0 && !allowFailure) {
        console.error(`\nExit ${status}: ${label}`);
        process.exit(status);
    }
    return status;
}

function main() {
    const cleanDaemonEnv = daemonEnvironment();

    run('pnpm', ['run', 'build']);
    run('talos', ['daemon', 'stop'], { allowFailure: true, env: cleanDaemonEnv });
    run('npm', ['link']);
    run('talos', ['daemon', 'start'], { env: cleanDaemonEnv });
    run('talos', ['--version'], { env: cleanDaemonEnv });

    console.log(`\n✓ Installed from ${PACKAGE_DIR}`);
    console.log('  To undo: npm unlink -g talosapp');
}

if (require.main === module) {
    main();
}

module.exports = {
    daemonEnvironment,
    sanitizeLifecyclePath,
};
