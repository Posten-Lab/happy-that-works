const fs = require('node:fs');
function verifiedBuild(payload, commit, expectedRuntime) {
  const builds = Array.isArray(payload) ? payload : [payload];
  if (builds.length !== 1) throw Error('Expected exactly one iOS build');
  const build = builds[0];
  if (!build || !/^[0-9a-f]{40}$/.test(commit || '') ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(build.id || '') || build.status !== 'FINISHED' ||
      build.platform !== 'IOS' || build.gitCommitHash !== commit ||
      build.buildProfile !== 'production' || build.distribution !== 'STORE') {
    throw Error('Build must be a finished production iOS store build for this commit');
  }
  if (expectedRuntime !== undefined && (!/^[a-f0-9]{40}$/.test(expectedRuntime) ||
      build.runtimeVersion !== expectedRuntime || build.fingerprint?.hash !== expectedRuntime)) {
    throw Error('Finished build must match the native fingerprint computed before building');
  }
  return build;
}

module.exports = { verifiedBuild };
if (require.main === module) {
  console.log(verifiedBuild(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), process.env.GIT_COMMIT, process.env.TALOS_EXPECTED_RUNTIME_VERSION).id);
}
