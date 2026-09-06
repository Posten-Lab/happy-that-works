#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const output = process.argv[2];
if (!output) throw new Error('Pass an output filename; this command never applies resources.');
let template = fs.readFileSync(path.join(__dirname, 'workloads.template.json'), 'utf8');
for (const key of ['TALOS_API_IMAGE', 'TALOS_WEB_IMAGE']) {
    const image = process.env[key] || '';
    if (!/^[a-z0-9][a-z0-9._:/-]+@sha256:[a-f0-9]{64}$/.test(image) || !image.includes('talos') || /happy|slopus|codium/i.test(image)) {
        throw new Error(`${key} must be an explicitly verified Talos image pinned by sha256 digest.`);
    }
    template = template.replaceAll(`__${key}__`, image);
}
JSON.parse(template);
fs.writeFileSync(output, template);
console.log(`Rendered additive Talos workloads to ${output}. No cluster changes made.`);
