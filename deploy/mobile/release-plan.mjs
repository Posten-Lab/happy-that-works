import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
export function classifyPath(path) {
  // Native/configuration inputs take precedence over bundled source paths.
  if (/^packages\/talos-app\/(plugins|patches|ios|android|modules|targets)\//.test(path) ||
      /^packages\/talos-app\/sources\/assets\//.test(path)) return 'native';
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(path) ||
      /^(docs|\.agents|\.github|deploy|environments)\//.test(path) ||
      /\.md$/.test(path) ||
      /^Dockerfile\.(server|webapp)$/.test(path) ||
      // npm publication tooling is not an input to an app bundle or native build.
      /^scripts\/(release\.cjs|configure-npm-publishing\.py)$/.test(path) ||
      /^packages\/(talos-cli|talos-server|talos-agent|talos-app-logs|talos-desktop)\//.test(path) ||
      /^packages\/talos-app\/(src-tauri|public)\//.test(path)) return 'none';
  if (/^packages\/talos-app\/(sources\/|index\.[jt]sx?$)/.test(path) ||
      /^packages\/talos-wire\/src\//.test(path)) return 'ota';
  // Unknown files, shared dependencies, patches and build scripts fail to native.
  return 'native';
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
    const kinds = paths.map(classifyPath);
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
