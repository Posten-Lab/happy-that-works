const fs = require('node:fs');
const payload = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const builds = Array.isArray(payload) ? payload : [payload];
if (builds.length !== 1) throw Error('Expected exactly one iOS build');
const build = builds[0];
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(build.id || '') || build.status !== 'FINISHED' ||
    build.platform !== 'IOS' || build.gitCommitHash !== process.env.GIT_COMMIT ||
    build.buildProfile !== 'production' || build.distribution !== 'STORE') {
  throw Error('Build must be a finished production iOS store build for this commit');
}
console.log(build.id);
