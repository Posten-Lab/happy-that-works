#!/usr/bin/env node
// Fault injection only: real Muse owns execution and durable history. Drop live
// item/completion notifications while passing requests and responses unchanged.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const child = spawn(process.env.MUSE_RECOVERY_REAL_CLI, process.argv.slice(2), { stdio: ['pipe', 'pipe', 'inherit'] });
process.stdin.pipe(child.stdin);
const lines = createInterface({ input: child.stdout });
lines.on('line', line => {
    const frame = JSON.parse(line);
    if (frame.id === undefined && (frame.method?.startsWith('item/') || frame.method === 'turn/completed')) {
        appendFileSync(process.env.MUSE_RECOVERY_DROP_LOG, `${frame.method}\n`);
    } else process.stdout.write(`${line}\n`);
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 1));
child.on('error', error => { console.error(error.message); process.exit(1); });
