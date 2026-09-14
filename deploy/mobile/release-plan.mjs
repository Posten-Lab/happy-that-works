import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
export function classifyPath(path) {
  // Native/configuration inputs take precedence over bundled source paths.
  if (/^packages\/talos-app\/(plugins|patches|ios|android|modules|targets)\//.test(path) ||
      /^packages\/talos-app\/sources\/assets\//.test(path)) return 'native';
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(path) ||
      /^(docs|\.agents|\.github|deploy|environments)\//.test(path) ||
      /\.md$/.test(path) ||
      /^Dockerfile\.(server|webapp)$/.test(path) ||
      // Evidence capture helpers do not ship in the app or affect its native build.
      /^scripts\/evidence\//.test(path) ||
      // npm publication tooling is not an input to an app bundle or native build.
      /^scripts\/(release\.cjs|configure-npm-publishing\.py)$/.test(path) ||
      /^packages\/(talos-cli|talos-server|talos-agent|talos-app-logs|talos-desktop)\//.test(path) ||
      /^packages\/talos-app\/(src-tauri|public)\//.test(path)) return 'none';
  if (/^packages\/talos-app\/(sources\/|index\.[jt]sx?$)/.test(path) ||
      /^packages\/talos-wire\/src\//.test(path)) return 'ota';
  // Unknown files, shared dependencies, patches and build scripts fail to native.
  return 'native';
}
function classifyChange(path, base, head) {
  // Publishing the JS-only wire package changes its version without changing
  // native dependencies. Everything else in either manifest still fails closed.
  if (path === 'packages/talos-wire/package.json') {
    try {
      const before = JSON.parse(git('show', `${base}:${path}`));
      const after = JSON.parse(git('show', `${head}:${path}`));
      const version = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
      if (before?.name === '@ahmadposten/talos-wire' && after?.name === before.name &&
          typeof before.version === 'string' && typeof after.version === 'string' &&
          version.test(before.version) && version.test(after.version)) {
        delete before.version; delete after.version;
        if (isDeepStrictEqual(before, after)) return 'ota';
      }
    } catch { /* Added, deleted or malformed manifests require native review. */ }
  }
  return classifyPath(path);
}
export function plan(base, head, mode = 'auto') {
  if (!['auto', 'native', 'ota', 'none'].includes(mode)) throw Error('Invalid release mode');
  if (!/^[a-f0-9]{40}$/.test(head)) throw Error('Head must be an exact commit SHA');
  git('cat-file', '-e', `${head}^{commit}`);
  let kind = 'native'; // No delivered baseline: bootstrap with a binary.
  if (base) {
    if (!/^[a-f0-9]{40}$/.test(base)) throw Error('Base must be an exact commit SHA');
    git('merge-base', '--is-ancestor', base, head);
    const paths = git('diff', '--no-renames', '--name-only', '-z', base, head).split('\0').filter(Boolean);
    const kinds = paths.map(path => classifyChange(path, base, head));
    kind = kinds.includes('native') ? 'native' : kinds.includes('ota') ? 'ota' : 'none';
  }
  if (mode === 'ota' && kind !== 'ota' || mode === 'none' && kind !== 'none') {
    throw Error(`Unsafe ${mode} override for ${kind} changes`);
  }
  return mode === 'native' ? 'native' : kind;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(plan(...process.argv.slice(2))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
