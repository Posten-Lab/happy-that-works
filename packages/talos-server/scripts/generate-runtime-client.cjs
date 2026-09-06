'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Keep the standalone client's generated code and native engine inside this
// package. Package-manager build caches do not retain writes to sibling packages.
function generateRuntimeClient(root = path.resolve(__dirname, '..')) {
  const output = path.join(root, 'dist', 'prisma-client');
  const temporary = fs.mkdtempSync(path.join(root, 'prisma', '.runtime-client-'));
  try {
    const schema = fs.readFileSync(path.join(root, 'prisma', 'schema.prisma'), 'utf8');
    const clientGenerator = /generator client\s*\{[^}]*\}/;
    if (!clientGenerator.test(schema)) throw new Error('The Prisma client generator is missing.');
    const runtimeSchema = schema.replace(clientGenerator, block => {
      if (/\boutput\s*=/.test(block)) throw new Error('Review the runtime client output before changing the source generator.');
      return block.replace(/\}$/, `    output = ${JSON.stringify(output)}\n}`);
    });
    const schemaPath = path.join(temporary, 'schema.prisma');
    fs.writeFileSync(schemaPath, runtimeSchema);
    fs.rmSync(output, { recursive: true, force: true });
    const result = spawnSync(process.execPath, [
      require.resolve('prisma/build/index.js'), 'generate', '--generator', 'client', '--schema', schemaPath,
    ], { cwd: root, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Runtime Prisma client generation failed (${result.status}).`);
    if (!fs.existsSync(path.join(output, 'index.js'))) throw new Error('The generated runtime client is missing.');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

module.exports = { generateRuntimeClient };
if (require.main === module) generateRuntimeClient();
