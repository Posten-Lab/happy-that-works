const fs = require('node:fs');
const { nativeRuntime } = require('./runtime-version.cjs');
function compatibility(fingerprint, config, builds) {
  const runtimeVersion = nativeRuntime(fingerprint, config);
  if (!Array.isArray(builds)) throw Error('Invalid EAS build history');
  const candidates = builds.filter(b => b?.status === 'FINISHED' && b.platform === 'IOS' &&
    b.buildProfile === 'production' && b.distribution === 'STORE' && b.runtimeVersion === runtimeVersion);
  // Native compatibility is now encoded in the runtime itself. Old runtimes and
  // history pagination cannot veto a verified build of the current runtime.
  const compatible = candidates.length > 0 && candidates.every(b => b.fingerprint?.hash === runtimeVersion);
  return { compatible, requiresNative: candidates.length === 0, runtimeVersion, matchingBuilds: candidates.length,
    reason: !candidates.length ? 'No finished production iOS binary for this native runtime.'
      : compatible ? 'Finished production binary matches the fingerprint runtime.'
        : 'Build metadata conflicts with its fingerprint runtime; refusing OTA.' };
}
module.exports = { compatibility };
if (require.main === module) {
  const result = compatibility(JSON.parse(fs.readFileSync('fingerprint-result.json', 'utf8')),
    JSON.parse(fs.readFileSync('runtime-config.json', 'utf8')),
    JSON.parse(fs.readFileSync('compatible-builds.json', 'utf8')));
  fs.writeFileSync('runtime-compatibility.json', JSON.stringify(result, null, 2) + '\n');
  if (!result.compatible && !result.requiresNative) throw Error(result.reason);
  console.log(result.compatible ? 'yes' : 'no');
}
