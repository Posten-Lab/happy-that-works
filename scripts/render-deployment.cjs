#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw new Error('Usage: node scripts/render-deployment.cjs <templates> <output>');
const values = {
    TALOS_WEB_HOST: process.env.TALOS_WEB_HOST,
    TALOS_API_HOST: process.env.TALOS_API_HOST,
    TALOS_FILES_HOST: process.env.TALOS_FILES_HOST,
    TALOS_NODE_HOST_1: process.env.TALOS_NODE_HOST_1,
    TALOS_NODE_HOST_2: process.env.TALOS_NODE_HOST_2,
    TALOS_WEB_NODE_PORT: process.env.TALOS_WEB_NODE_PORT,
    TALOS_API_NODE_PORT: process.env.TALOS_API_NODE_PORT,
    TALOS_FILES_NODE_PORT: process.env.TALOS_FILES_NODE_PORT,
};
const rendered = [];
for (const name of fs.readdirSync(source)) {
    const file = path.join(source, name);
    if (!fs.statSync(file).isFile()) continue;
    const text = fs.readFileSync(file, 'utf8').replace(/\$\{(TALOS_[A-Z0-9_]+)\}/g, (_, key) => {
        const value = values[key];
        if (key.endsWith('_NODE_PORT')) {
            if (!/^\d{5}$/.test(value || '') || Number(value) < 30000 || Number(value) > 32767) {
                throw new Error(`${key} must be an allocated Talos NodePort between 30000 and 32767.`);
            }
            return value;
        }
        if (!value || !/^(?=.{1,253}$)[a-z\d](?:[a-z\d.-]*[a-z\d])?$/i.test(value)) {
            throw new Error(`${key} must be a configured hostname before rendering ${name}.`);
        }
        return value;
    });
    rendered.push([name, text]);
}
// Validate every template before writing any output.
fs.mkdirSync(destination, { recursive: true });
for (const [name, text] of rendered) fs.writeFileSync(path.join(destination, name), text);
console.log(`Rendered ${rendered.length} Talos deployment files.`);
