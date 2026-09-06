# Happy mobile delivery

`happy-mobile` builds `main` using this Jenkinsfile and the existing `eas` agent.
After this PR merges, run the job once to load its polling trigger and establish
its first confirmed delivery. Subsequent main changes are polled every five minutes.

The job tests the app and release selector, typechecks, and exports a real iOS
bundle. Feature branches and `VALIDATE_ONLY` runs never release or advance the
release baseline. Production delivery remains iOS, matching the existing job.

Auto selection compares against the most recent successful run marked
`delivered:<commit>`, including all changes since failed or validation-only runs:

- App source and happy-wire source changes: production OTA.
- Native inputs, assets, configuration, dependencies, or unfamiliar paths: native
  production build followed by TestFlight submission.
- Documentation, CI, tests, desktop, or other packages only: no mobile delivery.
- No recorded baseline (including expired history): bootstrap with a native build.

`MOBILE_RELEASE_MODE=native` forces a binary. `ota` and `none` cannot override
incompatible pending changes. Expo fingerprint runtime policy prevents updates
from loading into incompatible binaries; this migration needs a new binary first.
Before OTA, the job also checks EAS for a finished production iOS store build
with the exact resolved runtime; missing compatibility falls back to native.
Commit SHA/timestamp labels are excluded from the fingerprint because they are
OTA metadata. All other Expo config stays in the fingerprint.

Submission uses the exact finished build for the checked-out commit, never
`--latest`. Both build and submission must finish successfully before the baseline
advances. ASC key ID, issuer, and private key come from Jenkins credentials; the
private key is cleaned up on failure as well as success. EAS submit reads the key
configuration from `eas.json`, whereas build uses `EXPO_ASC_API_KEY_PATH`.

Validation:

```sh
node --test deploy/mobile/release-plan.test.mjs
pnpm --filter @slopus/happy-wire build
pnpm --filter happy-app exec vitest run --maxWorkers=4
pnpm --filter happy-app typecheck
cd packages/happy-app
APP_ENV=production pnpm exec expo export --platform ios --output-dir dist-ci
```

A real Jenkins feature-branch run validates checkout, the Linux agent, isolated
pnpm installation, tests, and iOS export without sending a production update.
Actual OTA receipt on a device and TestFlight processing need post-merge release
validation; a successful export is not proof of either.
