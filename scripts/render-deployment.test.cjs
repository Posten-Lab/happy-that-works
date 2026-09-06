const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('deployment templates resolve configured hosts and preserve nginx variables', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'talos-render-'));
    const input = path.join(root, 'input'), output = path.join(root, 'output');
    fs.mkdirSync(input);
    fs.writeFileSync(path.join(input, 'site.conf'), 'server_name ${TALOS_WEB_HOST}; server ${TALOS_NODE_HOST_1}:${TALOS_WEB_NODE_PORT}; proxy_set_header Host $host;');
    try {
        const result = spawnSync(process.execPath, [path.join(__dirname, 'render-deployment.cjs'), input, output], {
            env: { ...process.env, TALOS_WEB_HOST: 'talos.test', TALOS_NODE_HOST_1: 'node.talos.test', TALOS_WEB_NODE_PORT: '32001' }, encoding: 'utf8',
        });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(fs.readFileSync(path.join(output, 'site.conf'), 'utf8'), 'server_name talos.test; server node.talos.test:32001; proxy_set_header Host $host;');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('service ports must be explicitly allocated within the NodePort range', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'talos-port-'));
    const input = path.join(root, 'input'), output = path.join(root, 'output');
    fs.mkdirSync(input);
    fs.writeFileSync(path.join(input, 'service.yaml'), 'nodePort: ${TALOS_API_NODE_PORT}');
    try {
        for (const port of ['', '80', '29999', '32768', '32000; include bad']) {
            const result = spawnSync(process.execPath, [path.join(__dirname, 'render-deployment.cjs'), input, output], {
                env: { ...process.env, TALOS_API_NODE_PORT: port }, encoding: 'utf8',
            });
            assert.notEqual(result.status, 0);
            assert.equal(fs.existsSync(output), false);
        }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a missing or unsafe host cannot partially overwrite existing deployment output', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'talos-render-'));
    const input = path.join(root, 'input'), output = path.join(root, 'output');
    fs.mkdirSync(input); fs.mkdirSync(output);
    fs.writeFileSync(path.join(input, 'a.conf'), 'server_name ${TALOS_WEB_HOST};');
    fs.writeFileSync(path.join(input, 'b.conf'), 'server_name ${TALOS_API_HOST};');
    fs.writeFileSync(path.join(output, 'a.conf'), 'existing config');
    try {
        for (const host of ['', 'talos.test; include /tmp/untrusted;']) {
            const result = spawnSync(process.execPath, [path.join(__dirname, 'render-deployment.cjs'), input, output], {
                env: { ...process.env, TALOS_WEB_HOST: 'talos.test', TALOS_API_HOST: host }, encoding: 'utf8',
            });
            assert.notEqual(result.status, 0);
            assert.equal(fs.readFileSync(path.join(output, 'a.conf'), 'utf8'), 'existing config');
            assert.equal(fs.existsSync(path.join(output, 'b.conf')), false);
        }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
