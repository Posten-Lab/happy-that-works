const fs = require('node:fs');
const { productionStoreIdentity } = require('../../packages/talos-app/store-identity.cjs');
function nativeRuntime(fingerprint, config) {
  const policy = config?.ios?.runtimeVersion ?? config?.runtimeVersion;
  if (policy?.policy !== 'fingerprint' || !/^[a-f0-9]{40}$/.test(fingerprint?.hash ?? '') ||
      config?.extra?.eas?.projectId !== productionStoreIdentity.easProjectId) {
    throw Error('Production OTA requires the owned project and a resolved fingerprint runtime');
  }
  return fingerprint.hash;
}
module.exports = { nativeRuntime };
if (require.main === module) {
  console.log(nativeRuntime(JSON.parse(fs.readFileSync('fingerprint-result.json', 'utf8')),
    JSON.parse(fs.readFileSync('runtime-config.json', 'utf8'))));
}
