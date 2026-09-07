import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { classifyPath } from './release-plan.mjs';
import { verifiedBuild } from './build-id.cjs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
export function reusableBuild(builds, head, runtime, runGit = git) {
  if (!Array.isArray(builds) || !/^[a-f0-9]{40}$/.test(head || '') || !/^[a-f0-9]{40}$/.test(runtime || '')) {
    throw Error('Reuse requires exact checkout, runtime and EAS build history');
  }
  if (runGit('rev-parse', 'HEAD').trim() !== head) {
    throw Error('Reuse requires a clean reviewed checkout: HEAD differs from the requested commit');
  }
  const status = runGit('status', '--porcelain', '--untracked-files=normal');
  if (status) throw Error(`Reuse requires a clean reviewed checkout; Git status: ${JSON.stringify(status)}`);
  for (const candidate of builds) {
    try {
      verifiedBuild(candidate, candidate?.gitCommitHash, runtime);
      if (typeof candidate.artifacts?.buildUrl !== 'string') continue;
      runGit('merge-base', '--is-ancestor', candidate.gitCommitHash, head);
      const paths = runGit('diff', '--no-renames', '--name-only', '-z', candidate.gitCommitHash, head).split('\0').filter(Boolean);
      // Retry delivery only when the intervening commits cannot affect either
      // application bundle or native inputs. A matching runtime alone is insufficient.
      if (paths.every(file => classifyPath(file) === 'none')) return candidate;
    } catch { /* Unverifiable, unrelated or incompatible build: do not reuse it. */ }
  }
  return null;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const head = process.env.GIT_COMMIT;
  const build = reusableBuild(JSON.parse(fs.readFileSync('compatible-builds.json', 'utf8')), head, process.env.TALOS_EXPECTED_RUNTIME_VERSION);
  const report = { reused: Boolean(build), checkoutCommit: head, buildCommit: build?.gitCommitHash ?? head, buildId: build?.id ?? null };
  fs.mkdirSync('dist-ci', { recursive: true });
  fs.writeFileSync('dist-ci/artifact-reuse.json', JSON.stringify(report, null, 2) + '\n');
  if (build) fs.writeFileSync('build-result.json', JSON.stringify([build]), { mode: 0o600 });
  console.log(build ? 'yes' : 'no');
}
