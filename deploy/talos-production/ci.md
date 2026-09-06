# Production Jenkins jobs

The production jobs use `deploy/web/Jenkinsfile`, `deploy/server/Jenkinsfile`, and `deploy/mobile/Jenkinsfile` from `git@github.com:Posten-Lab/happy-that-works.git`, branch `*/main`, with the existing `github-ssh-key` credential. Changes reach main through the repository's feature-branch and pull-request workflow.

Rename the existing `happy-web`, `happy-server`, and `happy-mobile` jobs to `talos-web`, `talos-server`, and `talos-mobile` through Jenkins's rename operation. Preserve their histories, job parameters and delivered-baseline descriptions. Do not copy the jobs and leave duplicate triggers enabled. Wait for an existing build to finish before changing its job definition; back up each original configuration privately first. The two disabled mobile validation jobs may remain disabled as historical evidence.

The web/API jobs retain GitHub push triggers. Mobile retains its five-minute SCM poll, `MOBILE_RELEASE_MODE` selector, and `VALIDATE_ONLY` parameter. Web/API also provide `VALIDATE_ONLY`: configuration, tests, and the web export run, while image publication and deployment are skipped. Validation-only successes do not record a deployment or delivered mobile baseline.

## Web and API

The Kubernetes agents use the existing `jenkins/jenkins` service account, CI node scheduling, and `dockerhub-credentials` volume. Agent checkout uses the canonical public HTTPS repository and the job's configured branch. The Node container uses Jenkins's UID/GID 1000 with writable `/home/node`; Kaniko retains its own root context. Build setup pins pnpm 10.11.0 and downloads kubectl 1.34.1 with its published SHA256 checksum. The Node build container runs kubectl with its mounted service-account identity; it does not copy credentials into the workspace.

Each job checks the exact checkout SHA and production Talos configuration, verifies the supplied branding, runs wire tests before consumer tests/typechecks, and tests the deployment helper. Kaniko pushes one commit/build-number tag and records its digest. Deployment uses that digest; no job publishes or deploys `latest`.

`release-component.cjs` can mutate only one existing Deployment: `happy/talos-api` or `happy/talos-web`. It preserves its service, datastore connections, encryption-secret reference, probes, scheduling, resource limits and other settings. The only changes are the component container image, Git SHA annotation, and `GIT_SHA` environment value. Initial infrastructure provisioning and database migrations are separate operator actions.

Before the write, the helper records the previous Deployment and desired pod template in private `release-evidence` files. The patch tests the current resource version and pod template. After Kubernetes readiness succeeds, public HTTPS checks require Talos identity and the exact released commit: `/v1/status` for API, `/talos-build.json` for web. Health attempts and rollout waits are bounded.

A failed rollout or public check restores only the previous Talos component template, then verifies its readiness and public health. If another operator changed the template, recovery refuses to overwrite that change. Jenkins's unsuccessful post-action also recovers a pending receipt after an interrupted stage. Agent loss or a failed rollback still requires an operator to inspect the archived receipt; no automation restores databases or changes the other component. Jenkins archives the prior manifest, final result and image digest.

For a pending receipt recovered on a trusted operator machine, use the exact values recorded in `release.json`:

```sh
node deploy/talos-production/release-component.cjs api IMAGE_DIGEST EXACT_COMMIT /path/to/release-evidence --recover
```

Use `web` for a web receipt. A completed or already recovered receipt is a no-op. Never edit the receipt to override the concurrency guard.

## Mobile

The iOS release updates the existing App Store app `6787151946`, using Apple team `H2XR8XWZXW`, Expo project `4445e993-5eaa-4a1a-8754-7068e8565e64`, and owner `posten-lab`. Native identifiers and the immutable Expo slug are continuity identifiers; the displayed app is Talos. Run the `ios` release preflight before any paid build or update.

Credentials remain Jenkins bindings: `expo-token`, `asc-key-id`, `asc-issuer-id`, and `asc-key-p8`. The Apple key is materialized outside the workspace with private permissions, tracing disabled and trap-based deletion. Builds are not retried automatically. Submission uses the single finished iOS store build ID whose Git commit matches this checkout; it never selects `--latest`. This stage submits to App Store Connect/TestFlight. Public App Store review and release remain a separate recorded action.

Before submission, Jenkins privately downloads that exact build's IPA and checks its installed name, retained bundle and keychain identity, version and runtime from the reviewed production configuration, advancing build number, and App Store provisioning profile. Checksum-pinned rcodesign 0.29.0 inspects every executable slice; XML and DER entitlements must agree and retain the installed app's default keychain group. The checker also requires the expected code-directory identity, verified CMS signatures, and no reported executable verification problems. rcodesign documents incomplete verification, so its result does not claim complete Apple signing validation; the Mac codesign comparison supplies separate native evidence. Validation runs install the pinned tools outside the checkout in a private temporary directory and exercise the rejection tests. Generated export and release receipts are ignored by Git/EAS upload and native fingerprinting. Jenkins archives the exact build ID, artifact hash and sanitized verification report; signed download URLs, the IPA and signing credentials are excluded from archives. Temporary tools are removed when the pipeline finishes.

The selector compares against the last successful delivered commit, so failed native changes remain pending. Documentation/server-only changes can skip delivery; native inputs require a binary. OTA additionally requires the configured runtime and matching native fingerprint for every returned finished production binary using that runtime. Missing data, conflicting fingerprints, or a full 50-row result prevent OTA. Auto mode then builds a native artifact; a forced OTA request fails. A future incompatible native change should receive a new runtime before delivery so older installed binaries cannot receive its updates.

Expo's [BuildFragment](https://github.com/expo/eas-cli/blob/main/packages/eas-cli/src/graphql/types/Build.ts) includes the fingerprint hash used by this check. No old-runtime update is published as part of the Talos branding change.
