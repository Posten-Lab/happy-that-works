#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const issues = [];
const roots = ['packages/talos-app/sources', 'packages/talos-cli/src', 'packages/talos-agent/src',
    'packages/talos-server/sources', 'packages/talos-wire/src', 'packages/talos-desktop/sources'];
const compatibility = new Set(['packages/talos-wire/src/compatibility.ts',
    'packages/talos-server/sources/config/masterSecret.ts']);
const excluded = /(?:\.(?:test|spec|appspec)\.[cm]?[jt]sx?$|\/__fixtures__\/|\/__tests__\/|\/assets\/|\.jsonl$)/;

function walk(directory) {
    for (const item of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
        const file = `${directory}/${item.name}`;
        if (item.isDirectory()) { if (item.name !== 'node_modules') walk(file); continue; }
        if (compatibility.has(file) || excluded.test(file) || !/\.[cm]?[jt]sx?$/.test(file)) continue;
        fs.readFileSync(path.join(root, file), 'utf8').split('\n').forEach((line, index) => {
            if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return;
            if (/happy|slopus|codium|handy/i.test(line)) issues.push(`${file}:${index + 1}: previous identity in product code`);
        });
    }
}
roots.forEach(walk);

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/talos/manifest.json'), 'utf8'));
for (const asset of manifest.assets) {
    for (const file of [asset.source, asset.destination]) {
        if (!fs.existsSync(path.join(root, file))) { issues.push(`Missing brand asset: ${file}`); continue; }
        const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
        if (actual !== asset.sha256) issues.push(`Asset differs from supplied Talos artwork: ${file}`);
    }
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const names = new Set();
for (const directory of pkg.workspaces.packages) {
    const workspace = JSON.parse(fs.readFileSync(path.join(root, directory, 'package.json'), 'utf8'));
    if (!/talos/.test(workspace.name) || names.has(workspace.name)) issues.push(`Invalid workspace identity: ${directory}`);
    names.add(workspace.name);
    for (const [command, target] of Object.entries(workspace.bin || {})) {
        if (!command.startsWith('talos') || !fs.existsSync(path.join(root, directory, target))) issues.push(`Invalid command entry point: ${command}`);
    }
}
const images = fs.readdirSync(path.join(root, 'packages/talos-app/sources/assets/images'));
if (images.some(name => name.startsWith('logotype'))) issues.push('Obsolete logotype assets remain.');
for (const file of ['packages/talos-app/public/index.html', 'packages/talos-app/public/site.webmanifest',
    'packages/talos-app/app.config.js', 'packages/talos-app/src-tauri/tauri.conf.json']) {
    if (/happy|slopus|codium/i.test(fs.readFileSync(path.join(root, file), 'utf8'))) issues.push(`Previous identity in ${file}`);
}

if (issues.length) {
    console.error(issues.join('\n'));
    process.exitCode = 1;
} else {
    console.log(`Talos identity verified: ${names.size} workspaces, ${manifest.assets.length} supplied assets, and all product source directories.`);
}
