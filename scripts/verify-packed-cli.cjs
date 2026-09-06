#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error('Run this check with pnpm verify:packaged.');
const args = process.argv.slice(2);
const cliOnly = args.includes('--cli-only');
const artifactsIndex = args.indexOf('--artifacts-dir');
const suppliedArtifacts = artifactsIndex !== -1 ? args[artifactsIndex + 1] : undefined;
if (artifactsIndex !== -1) assert.ok(suppliedArtifacts && !suppliedArtifacts.startsWith('--'), 'Missing --artifacts-dir value.');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'talos-packaged-'));
const artifacts = suppliedArtifacts ? fs.realpathSync(suppliedArtifacts) : path.join(directory, 'artifacts');
if (!suppliedArtifacts) fs.mkdirSync(artifacts);
const log = path.join(directory, 'verification.log');
const env = { ...process.env, TALOS_HOME_DIR: path.join(directory, 'state'), CI: '1' };

function run(args, cwd = root) {
    const result = spawnSync(process.execPath, [pnpm, ...args], {
        cwd, env, encoding: 'utf8', timeout: 240000, maxBuffer: 32 * 1024 * 1024,
    });
    fs.appendFileSync(log, `${args.join(' ')}\n${result.stdout || ''}${result.stderr || ''}\n`);
    if (result.error || result.status !== 0) throw new Error(`${args.join(' ')} failed. See ${log}\n${result.error || (result.stderr || result.stdout).slice(-4000)}`);
    return result.stdout;
}

async function main() {
    console.log(`Talos package verification: ${directory}`);
    const archives = {};
    const packages = {};
    for (const name of cliOnly ? ['talos-wire', 'talos-cli'] : ['talos-wire', 'talos-cli', 'talos-server', 'talos-agent']) {
        const packagePath = path.join(root, 'packages', name);
        const pkg = JSON.parse(fs.readFileSync(path.join(packagePath, 'package.json'), 'utf8'));
        assert.ok(fs.existsSync(path.join(packagePath, 'dist')), `Build ${name} before packing.`);
        if (!suppliedArtifacts) run(['--dir', packagePath, 'pack', '--pack-destination', artifacts]);
        archives[pkg.name] = `file:${path.join(artifacts, `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`).replaceAll('\\', '/')}`;
        packages[pkg.name] = pkg;
    }
    for (const linker of ['isolated', 'hoisted']) {
        await verifyInstallation(linker, archives, packages, `${linker}-cli-only`, true);
    }
    if (!cliOnly) for (const [linker, scenario] of [['isolated', 'isolated'], ['hoisted', 'hoisted'], ['hoisted', 'hoisted-cached']]) {
        await verifyInstallation(linker, archives, packages, scenario, false);
    }
}

async function verifyInstallation(linker, archives, packages, scenario, onlyCli) {
    const fixture = path.join(directory, `installation-${scenario}`);
    fs.mkdirSync(fixture);
    fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({
        name: 'talos-package-verification', private: true,
        dependencies: {
            talosapp: archives.talosapp,
            ...(!onlyCli ? {
                '@ahmadposten/talos-server': archives['@ahmadposten/talos-server'],
                '@ahmadposten/talos-agent': archives['@ahmadposten/talos-agent'],
            } : {}),
        },
        pnpm: {
            overrides: { '@ahmadposten/talos-wire': archives['@ahmadposten/talos-wire'] },
            onlyBuiltDependencies: ['talosapp', '@ahmadposten/talos-server', '@prisma/client', '@prisma/engines', 'prisma', 'sharp', 'esbuild'],
        },
    }, null, 2));
    fs.writeFileSync(path.join(fixture, '.npmrc'), `node-linker=${linker}\n`);
    run(['install', '--prefer-offline', `--node-linker=${linker}`, '--shamefully-hoist=false'], fixture);
    assert.ok(fs.readFileSync(path.join(fixture, 'node_modules', '.modules.yaml'), 'utf8').includes(`nodeLinker: ${linker}`));
    const help = run(['exec', 'talos', '--help'], fixture);
    assert.match(help, /Talos/i);
    assert.doesNotMatch(help, /happy|slopus|codium/i);
    const version = run(['exec', 'talos', '--version'], fixture);
    assert.equal(version.trim(), `talos version: ${packages.talosapp.version}`);
    for (const args of [['doctor'], ['daemon', 'status']]) run(['exec', 'talos', ...args], fixture);
    const cliRoot = fs.realpathSync(path.join(fixture, 'node_modules', 'talosapp'));
    const cliRequire = createRequire(path.join(cliRoot, 'package.json'));
    for (const tool of ['rg', 'difft']) {
        const binary = path.join(cliRoot, 'tools', 'unpacked', `${tool}${process.platform === 'win32' ? '.exe' : ''}`);
        const result = spawnSync(binary, ['--version'], { env, encoding: 'utf8', timeout: 10000 });
        assert.ifError(result.error);
        assert.equal(result.status, 0, `${tool} failed: ${result.stderr}`);
        assert.ok(result.stdout.trim(), `${tool} did not report a version.`);
    }
    assert.ok(fs.statSync(path.join(cliRoot, 'tools', 'unpacked', 'ripgrep.node')).isFile(), 'Missing optional search addon.');
    const searchFile = path.join(fixture, 'search fixture.txt');
    fs.writeFileSync(searchFile, 'talos-packaged-search-match\n');
    const launcher = path.join(cliRoot, 'scripts', 'ripgrep_launcher.cjs');
    for (const [pattern, exitCode, stdout] of [
        ['talos-packaged-search-match', 0, 'talos-packaged-search-match\n'],
        ['talos-packaged-search-absent', 1, ''],
        ['[', 2, ''],
    ]) {
        const result = spawnSync(process.execPath, [launcher, JSON.stringify([
            '--no-heading', '--no-filename', '--color', 'never', '--', pattern, searchFile,
        ])], { cwd: fixture, env, encoding: 'utf8', timeout: 10000 });
        fs.appendFileSync(log, `Search launcher: expected exit ${exitCode}\n${result.stdout || ''}${result.stderr || ''}\n`);
        assert.ifError(result.error);
        assert.equal(result.status, exitCode, `Search launcher failed: ${result.stderr}`);
        assert.equal(result.stdout.replaceAll('\r\n', '\n'), stdout, 'Search stdout must contain only search results.');
    }
    if (onlyCli) {
        for (const companion of ['@ahmadposten/talos-server', '@ahmadposten/talos-agent']) {
            assert.ok(!fs.existsSync(path.join(fixture, 'node_modules', companion)), `${companion} must not be installed.`);
            assert.throws(() => cliRequire.resolve(companion), { code: 'MODULE_NOT_FOUND' });
        }
        console.log(`Packed Talos CLI-only install, optional peer absence, versions, diagnostics, native tools, and launcher searches passed (${linker}).`);
        return;
    }
    assert.match(run(['exec', 'talos-agent', '--help'], fixture), /talos-agent/);
    assert.ok(run(['exec', 'talos-agent', '--version'], fixture).includes(packages['@ahmadposten/talos-agent'].version));
    console.log(`Packed Talos CLI, agent, versions, diagnostics, and daemon status passed (${scenario}).`);

    const listener = net.createServer();
    await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
    const port = listener.address().port;
    await new Promise(resolve => listener.close(resolve));
    const serverLog = fs.openSync(path.join(directory, 'server.log'), 'a');
    const child = spawn(process.execPath, ['--no-warnings', '--no-deprecation', path.join(fixture, 'node_modules/talosapp/bin/talos.mjs'),
        'server', '--port', String(port), '--host', '127.0.0.1', '--no-persist'], {
        cwd: fixture, env, stdio: ['ignore', serverLog, serverLog],
    });
    try {
        const base = `http://127.0.0.1:${port}`;
        const deadline = Date.now() + 90000;
        let ready = false;
        while (Date.now() < deadline && child.exitCode === null) {
            try {
                const response = await fetch(`${base}/v1/status`, { signal: AbortSignal.timeout(2000) });
                assert.deepEqual(await response.json(), { service: 'talos', protocol: 1 });
                ready = true; break;
            } catch { await new Promise(resolve => setTimeout(resolve, 500)); }
        }
        assert.ok(ready, `Packaged relay did not start. See ${directory}/server.log`);
        const publicKey = encodeURIComponent(Buffer.alloc(32).toString('base64'));
        const response = await fetch(`${base}/v1/auth/request/status?publicKey=${publicKey}`, { signal: AbortSignal.timeout(5000) });
        assert.ok(response.ok);
        assert.ok('status' in await response.json(), 'Database-backed authentication route failed.');
        const html = await (await fetch(base, { signal: AbortSignal.timeout(5000) })).text();
        assert.match(html, /<title>Talos<\/title>/);
        assert.match(html, /__TALOS_CONFIG__/);
        console.log(`Packed Talos relay, database, identity endpoint, and bundled web application passed (${scenario}).`);
    } finally {
        const exited = child.exitCode !== null || child.signalCode !== null
            ? Promise.resolve()
            : new Promise(resolve => {
                child.once('exit', resolve);
                setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 10000).unref();
            });
        if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
        else child.kill('SIGTERM');
        await exited;
        fs.closeSync(serverLog);
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
