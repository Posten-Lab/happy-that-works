const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { verifiedBuild } = require('./build-id.cjs');

function artifactUrl(value, base) {
  let url;
  try { url = new URL(value, base); } catch { throw Error('Invalid iOS artifact URL'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw Error('iOS artifact requires HTTPS without URL credentials');
  return url;
}

async function downloadArtifact(payload, target, commit, options = {}) {
  const build = verifiedBuild(payload, commit);
  // EAS returns this URL on the exact completed build, which was checked above.
  // Keep signed URLs inside this process; never pass them to a shell or logger.
  if (typeof build.artifacts?.buildUrl !== 'string') throw Error('Completed iOS build has no downloadable artifact');
  let url = artifactUrl(build.artifacts.buildUrl);
  const request = options.fetch || fetch;
  const maxBytes = options.maxBytes || 1024 * 1024 * 1024;
  const signal = AbortSignal.timeout(options.timeoutMs || 10 * 60 * 1000);
  let handle;
  try {
    let response;
    for (let redirects = 0; redirects <= 5; redirects++) {
      response = await request(url, { redirect: 'manual', signal });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location || redirects === 5) throw Error('iOS artifact redirect limit or destination invalid');
      url = artifactUrl(location, url);
    }
    if (response.status !== 200 || !response.body) throw Error('iOS artifact download failed');
    const declared = response.headers.get('content-length');
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw Error('iOS artifact exceeds size limit');
    handle = await fs.open(target, 'wx', 0o600);
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) throw Error('iOS artifact exceeds size limit');
      hash.update(chunk);
      await handle.writeFile(chunk);
    }
    if (!bytes) throw Error('iOS artifact is empty');
    await handle.close();
    handle = undefined;
    return { buildId: build.id, bytes, sha256: hash.digest('hex') };
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => {});
      await fs.unlink(target).catch(() => {});
    }
    // Underlying fetch errors may contain signed URLs. Do not relay their text.
    throw Error('Unable to download the verified iOS artifact securely');
  }
}

module.exports = { downloadArtifact };
if (require.main === module) {
  (async () => {
    if (process.argv.length !== 4) throw Error('Expected build-result JSON and destination IPA path');
    const result = await downloadArtifact(JSON.parse(await fs.readFile(process.argv[2], 'utf8')), process.argv[3], process.env.GIT_COMMIT);
    console.log(JSON.stringify(result));
  })().catch(() => { console.error('Verified iOS artifact download failed; submission is blocked.'); process.exitCode = 1; });
}
