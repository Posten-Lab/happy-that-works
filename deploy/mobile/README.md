# Talos mobile delivery

`talos-mobile` builds `main` using this Jenkinsfile and the existing `eas` agent.
After this PR merges, run the job once to load its polling trigger and establish
its first confirmed delivery. Subsequent main changes are polled every five minutes.

The job tests the app and release selector, typechecks, and exports a real iOS
bundle. Feature branches and `VALIDATE_ONLY` runs never release or advance the
release baseline. Validation-only main runs still classify the release so branch
detection and bootstrap decisions can be exercised without publishing. The
explicit checkout exports its returned Git branch and SHA into the pipeline
environment; missing metadata fails the run. Production delivery remains iOS, matching the existing job.

Auto selection compares against the most recent successful run marked
`delivered:<commit>`, including all changes since failed or validation-only runs:

- App source and Talos wire source changes: production OTA, subject to compatibility checks.
- Native inputs, assets, configuration, dependencies, or unfamiliar paths: native
  production build followed by TestFlight submission.
- Documentation, CI, tests, desktop, or other packages only: no mobile delivery.
- No recorded baseline (including expired history): bootstrap with a native build.

`MOBILE_RELEASE_MODE=native` forces a binary. `ota` and `none` cannot override
incompatible pending changes. This migration needs a new native binary first.
Before OTA, the job checks the literal runtime and native fingerprint against all
returned finished production iOS binaries for that runtime. Missing, conflicting,
or incomplete compatibility evidence falls back to native.
Commit SHA/timestamp labels are excluded from the fingerprint because they are
OTA metadata. All other Expo config stays in the fingerprint. The production EAS profile
uses `NPM_CONFIG_NODE_LINKER=isolated` and `NPM_CONFIG_SHAMEFULLY_HOIST=false`
to match Jenkins. Switching dependency layouts changes autolinking paths and
therefore runtime fingerprints, even with the same lockfile.

Submission uses the exact finished build for the checked-out commit, never
`--latest`. Both build and submission must finish successfully before the baseline
advances. ASC key ID, issuer, and private key come from Jenkins credentials; the
private key is cleaned up on failure as well as success. EAS submit reads the key
configuration from `eas.json`, whereas build uses `EXPO_ASC_API_KEY_PATH`.

Validation:

```sh
node --test deploy/mobile/release-plan.test.mjs
pnpm --filter @ahmadposten/talos-wire build
pnpm --filter talos-app exec vitest run --maxWorkers=4
pnpm --filter talos-app typecheck
cd packages/talos-app
APP_ENV=production pnpm exec expo export --platform ios --output-dir dist-ci
```

A real Jenkins feature-branch run validates checkout, the Linux agent, isolated
pnpm installation, tests, and iOS export without sending a production update.
Actual OTA receipt on a device and TestFlight processing need post-merge release
validation; a successful export is not proof of either.
