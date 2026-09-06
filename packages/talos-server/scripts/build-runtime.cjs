'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { generateRuntimeClient } = require('./generate-runtime-client.cjs');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const dist = path.join(root, 'dist');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
generateRuntimeClient(root);

const args = [
  'build',
  './sources/standalone.ts',
  '--target',
  'node',
  '--format',
  'esm',
  '--outfile',
  'dist/standalone.mjs',
];

const bundledDependencies = new Set([
  // Keep the standalone relay schemas aligned with the exact workspace build.
  '@ahmadposten/talos-wire',
]);

for (const dependency of Object.keys(pkg.dependencies ?? {})) {
  if (bundledDependencies.has(dependency)) continue;
  args.push('--external', dependency);
}

const result = spawnSync('bun', args, {
  cwd: root,
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}
if (result.status !== 0) process.exit(result.status ?? 1);

const entry = path.join(dist, 'standalone.mjs');
const runtime = fs.readFileSync(entry, 'utf8');
if (!runtime.includes('from "@prisma/client"')) throw new Error('Review the standalone Prisma import before publishing.');
fs.writeFileSync(entry, runtime.replaceAll('from "@prisma/client"', 'from "./prisma-client/index.js"'));

process.exit(result.status ?? 1);
