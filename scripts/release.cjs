#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { validateReleaseConfig } = require('./verify-release-config.cjs');
const repoRoot = path.resolve(__dirname, '..');
const registry = 'https://registry.npmjs.org';
const publisher = 'ahmadposten';
const definitions = {
    wire: ['packages/talos-wire', '@ahmadposten/talos-wire'],
    server: ['packages/talos-server', '@ahmadposten/talos-server'],
    agent: ['packages/talos-agent', '@ahmadposten/talos-agent'],
    cli: ['packages/talos-cli', 'talosapp'],
};

function parseArgs(input) {
    const args = input[0] === '--' ? input.slice(1) : [...input];
    let target, tag = 'latest', publish = false, plan = false, help = false;
    const seen = new Set();
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith('-')) {
            if (seen.has(arg)) throw Error(`Repeated option: ${arg}`);
            seen.add(arg);
            if (arg === '--publish') publish = true;
            else if (arg === '--plan' || arg === '--dry-run') plan = true;
            else if (arg === '--help') help = true;
            else if (arg === '--tag') {
                tag = args[++i];
                if (!/^[a-z][a-z0-9-]*$/.test(tag || '')) throw Error('Invalid npm dist-tag.');
            } else throw Error(`Unknown option: ${arg}`);
        } else {
            if (target || (!definitions[arg] && arg !== 'all')) throw Error(`Unknown or extra release target: ${arg}`);
            target = arg;
        }
    }
    if (publish && (plan || help)) throw Error('--publish cannot be combined with a plan, dry run, or help.');
    return { target: target || 'all', tag, publish, help };
}

function releasePlan(options, root = repoRoot) {
    const targets = options.target === 'all' ? Object.keys(definitions) : [options.target];
    return targets.map(id => {
        const [directory, name] = definitions[id];
        const pkg = JSON.parse(fs.readFileSync(path.join(root, directory, 'package.json'), 'utf8'));
        if (pkg.name !== name || pkg.private || !pkg.scripts?.prepublishOnly ||
            pkg.publishConfig?.registry !== registry || pkg.publishConfig?.access !== 'public' ||
            !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)) {
            throw Error(`Package ${id} has an invalid release identity or configuration.`);
        }
        return { id, name, version: pkg.version, directory,
            command: ['pnpm', 'publish', '--access', 'public', '--tag', options.tag, '--no-git-checks', '--registry', registry] };
    });
}

function publishingEnvironment(env = process.env, home = os.homedir()) {
    const userconfig = env.TALOS_NPM_USERCONFIG || path.join(home, '.config/talos/npm-publish.npmrc');
    if (!path.isAbsolute(userconfig)) throw Error('TALOS_NPM_USERCONFIG must be an absolute private file path.');
    let info;
    try { info = fs.lstatSync(userconfig); } catch {
        throw Error('Talos publishing credentials are missing. Run python3 scripts/configure-npm-publishing.py, or bind a private CI file with TALOS_NPM_USERCONFIG.');
    }
    if (!info.isFile() || (process.platform !== 'win32' &&
        ((info.mode & 0o077) !== 0 || info.uid !== process.getuid()))) {
        throw Error('Talos publishing credentials must be a regular private file owned by the publishing user (mode 0600 on Unix).');
    }
    // Set both spellings: npm lifecycle environments can contain a lowercase
    // value that otherwise overrides the uppercase operator configuration.
    return { npm_config_userconfig: userconfig, NPM_CONFIG_USERCONFIG: userconfig };
}

function runRelease(options, { root = repoRoot, run = spawnSync, env = process.env, home = os.homedir(), log = console.log } = {}) {
    const plan = releasePlan(options, root);
    log(JSON.stringify({ mode: options.publish ? 'publish' : 'plan', registry, publisher, packages: plan }, null, 2));
    if (!options.publish) return plan;
    const releaseEnv = { ...env, npm_config_registry: registry, NPM_CONFIG_REGISTRY: registry,
        npm_config_ignore_scripts: 'false', NPM_CONFIG_IGNORE_SCRIPTS: 'false',
        npm_config_dry_run: 'false', NPM_CONFIG_DRY_RUN: 'false' };
    const includesServer = plan.some(item => item.id === 'server');
    if (includesServer) {
        if (releaseEnv.APP_ENV !== 'production') throw Error('Server publication requires APP_ENV=production and verified production web configuration.');
        const errors = validateReleaseConfig(releaseEnv, 'web');
        if (errors.length) throw Error(`Server publication configuration is invalid: ${errors.join(' ')}`);
    }
    Object.assign(releaseEnv, publishingEnvironment(env, home));
    const capture = (command, args) => {
        const result = run(command, args, { cwd: root, env: releaseEnv, encoding: 'utf8', stdio: 'pipe' });
        if (result.error) throw Error(`Unable to run ${command}.`);
        return result;
    };
    const identity = capture('npm', ['whoami', '--registry', registry]);
    if (identity.status !== 0 || identity.stdout?.trim() !== publisher) throw Error(`npm authentication must identify ${publisher}; publication did not start.`);
    if (includesServer) {
        const bun = capture('bun', ['--version']);
        if (bun.status !== 0) throw Error('Server publication requires Bun on PATH.');
    }
    const versionExists = item => {
        const result = capture('npm', ['view', `${item.name}@${item.version}`, 'version', '--json', '--registry', registry]);
        if (result.status === 0) {
            try { if (JSON.parse(result.stdout) === item.version) return true; } catch { /* fail closed below */ }
            throw Error(`Unexpected registry metadata for ${item.name}; publication stopped.`);
        }
        // npm --json can write its error object to stdout or stderr.
        for (const output of [result.stdout, result.stderr]) {
            try { if (JSON.parse(output).error?.code === 'E404') return false; } catch { /* inspect the other stream */ }
        }
        throw Error(`Unable to verify registry availability for ${item.name}; publication stopped.`);
    };
    for (const item of plan) {
        if (versionExists(item)) throw Error(`${item.name}@${item.version} is already published. Verify it or set a new version; it will not be overwritten.`);
    }
    const wire = releasePlan({ target: 'wire', tag: options.tag }, root)[0];
    if (!plan.some(item => item.id === 'wire')) {
        if (!versionExists(wire)) throw Error('Publish the current wire package before a consumer package.');
        const built = run('pnpm', ['--filter', wire.name, 'test'], { cwd: root, env: releaseEnv, stdio: 'inherit' });
        if (built.error || built.status !== 0) throw Error('Wire checks failed; publication stopped.');
    }
    for (const item of plan) {
        const result = run(item.command[0], item.command.slice(1), {
            cwd: path.join(root, item.directory), env: releaseEnv, stdio: 'inherit',
        });
        if (result.error || result.status !== 0) {
            throw Error(`Publication of ${item.name}@${item.version} failed. Check registry metadata before another attempt; no retry was made.`);
        }
        if (!versionExists(item)) throw Error(`The registry has not confirmed ${item.name}@${item.version}. Verify its state before continuing.`);
        log(`Published ${item.name}@${item.version}`);
    }
    return plan;
}

function main(args) {
    const options = parseArgs(args);
    if (options.help) {
        console.log('Usage: pnpm release [wire|server|agent|cli|all] [--plan|--dry-run|--publish] [--tag latest]\nDefaults to a local plan. Only --publish uploads packages; it retains every prepublish check. No versions, tags, branches, or git remotes are changed.');
        return;
    }
    runRelease(options);
}
if (require.main === module) {
    try { main(process.argv.slice(2)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { parseArgs, releasePlan, runRelease, publishingEnvironment, registry, publisher };
