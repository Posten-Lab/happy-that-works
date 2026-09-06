// Decode rcodesign's documented YAML using a pinned established parser.
const fs = require('node:fs');
const path = require('node:path');
const YAML = require(path.join(path.resolve(process.argv[2]), 'yaml/package/dist/index.js'));
const input = fs.readFileSync(0, 'utf8');
if (input.length > 16 * 1024 * 1024) throw new Error('Signature report exceeds size limit');
const output = YAML.parse(input, { maxAliasCount: 0, uniqueKeys: true });
process.stdout.write(JSON.stringify(output));
