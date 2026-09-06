const fs = require('node:fs');
const { hash } = JSON.parse(fs.readFileSync('fingerprint-result.json', 'utf8'));
const { runtimeVersion, extra } = JSON.parse(fs.readFileSync('runtime-config.json', 'utf8'));
const builds = JSON.parse(fs.readFileSync('compatible-builds.json', 'utf8'));
if (!/^[a-f0-9]{40}$/.test(hash) || !Array.isArray(builds) ||
    typeof runtimeVersion !== 'string' || !runtimeVersion ||
    extra?.eas?.projectId !== '4445e993-5eaa-4a1a-8754-7068e8565e64') throw Error('Invalid EAS runtime response');
// The first Talos binary deliberately has a new literal OTA runtime. A runtime
// label alone cannot prove that a later native change is safe for that binary.
// Every finished production binary using this literal runtime must agree. A
// match against just the newest binary could send incompatible JavaScript to
// an older installed binary. An incomplete (50-row) history fails closed too.
const candidates = builds.filter(b => b.status === 'FINISHED' && b.platform === 'IOS' &&
  b.buildProfile === 'production' && b.distribution === 'STORE' && b.runtimeVersion === runtimeVersion);
console.log(candidates.length > 0 && builds.length < 50 &&
  candidates.every(b => b.fingerprint?.hash === hash) ? 'yes' : 'no');
