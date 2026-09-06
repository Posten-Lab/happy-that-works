#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error('Run this check with pnpm verify:packaged.');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'talos-packaged-'));
const artifacts = path.join(directory, 'artifacts');
const fixture = path.join(directory, 'installation');
fs.mkdirSync(artifacts); fs.mkdirSync(fixture);
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
    for (const name of ['talos-wire', 'talos-cli', 'talos-server']) {
        const packagePath = path.join(root, 'packages', name);
        const pkg = JSON.parse(fs.readFileSync(path.join(packagePath, 'package.json'), 'utf8'));
        assert.ok(fs.existsSync(path.join(packagePath, 'dist')), `Build ${name} before packing.`);
        run(['--dir', packagePath, 'pack', '--pack-destination', artifacts]);
        archives[pkg.name] = `file:${path.join(artifacts, `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`).replaceAll('\\', '/')}`;
    }
    fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({
        name: 'talos-package-verification', private: true,
        dependencies: { talos: archives.talos, 'talos-server': archives['talos-server'] },
        pnpm: {
            overrides: { '@talos/wire': archives['@talos/wire'] },
            onlyBuiltDependencies: ['talos', 'talos-server', '@prisma/client', '@prisma/engines', 'prisma', 'sharp', 'esbuild'],
        },
    }, null, 2));
    fs.writeFileSync(path.join(fixture, '.npmrc'), 'node-linker=hoisted\n');
    run(['install', '--prefer-offline'], fixture);
    const help = run(['exec', 'talos', '--help'], fixture);
    assert.match(help, /Talos/i);
    assert.doesNotMatch(help, /happy|slopus|codium/i);
    for (const args of [['--version'], ['doctor'], ['daemon', 'status']]) run(['exec', 'talos', ...args], fixture);
    console.log('Packed Talos command, version, diagnostics, and daemon status passed.');

    const listener = net.createServer();
    await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
    const port = listener.address().port;
    await new Promise(resolve => listener.close(resolve));
    const serverLog = fs.openSync(path.join(directory, 'server.log'), 'a');
    const child = spawn(process.execPath, [path.join(fixture, 'node_modules/talos/bin/talos.mjs'),
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
        console.log('Packed Talos relay, database, identity endpoint, and bundled web application passed.');
    } finally {
        if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
        else child.kill('SIGTERM');
        fs.closeSync(serverLog);
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
