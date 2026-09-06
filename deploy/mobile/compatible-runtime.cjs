const fs = require('node:fs');
const { hash } = JSON.parse(fs.readFileSync('fingerprint-result.json', 'utf8'));
const builds = JSON.parse(fs.readFileSync('compatible-builds.json', 'utf8'));
if (!/^[a-f0-9]{40}$/.test(hash) || !Array.isArray(builds)) throw Error('Invalid EAS runtime response');
console.log(builds.some(b => b.status === 'FINISHED' && b.platform === 'IOS' &&
  b.buildProfile === 'production' && b.distribution === 'STORE' && b.runtimeVersion === hash) ? 'yes' : 'no');
