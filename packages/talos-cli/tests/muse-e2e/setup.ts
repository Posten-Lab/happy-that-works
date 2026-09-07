import { writeFileSync } from 'node:fs';
import { createIntegrationEnvironment } from '../../src/testing/integrationEnvironment';
// Suppress the environment manager's credential-bearing auth URL.
const log = console.log;
console.log = () => {};
try {
    const env = await createIntegrationEnvironment();
    writeFileSync('/tmp/talos-muse-environment.json', JSON.stringify(env));
    log(JSON.stringify(env));
} finally { console.log = log; }
