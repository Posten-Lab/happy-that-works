# Deterministic native runtimes and OTA delivery

Jenkins mobile #31 classified the usage-card fix as OTA, then fell back to native. Actual EAS fingerprints for builds 18 and 19 differed only in `eas.json` (107 sources in each). The pipeline prepared App Store submission before building, putting a random temporary Apple-key file path in that fingerprinted file. Builds 15, 17, 18 and 19 also shared `talos-1`, despite different fingerprints, so the all-builds-match compatibility condition could never succeed.

## Change

- Use Expo's supported fingerprint runtime policy. Native inputs determine the update runtime; JavaScript-only changes retain it.
- Compute the production fingerprint before building. Verify the exact finished build's commit, runtime and fingerprint before checking the IPA and submitting its ID.
- Prepare submission configuration only after building and verifying the binary. Restore the original `eas.json` bytes on success, failure or termination.
- Match only finished production iOS store builds of the current fingerprint runtime. Old runtime history and the 50-row query limit cannot veto a verified current runtime. Conflicting metadata still rejects OTA.
- Archive fingerprints, resolved runtimes and compatibility decisions in Jenkins so future fallbacks have inspectable evidence.

## Migration

Already installed `talos-1` binaries cannot be relabelled. One native migration build is required. Future compatible changes can use OTA; native changes naturally get another runtime. This does not send updates to older incompatible binaries or bypass compatibility verification.

## Verification

`node --test deploy/mobile/*.test.cjs deploy/mobile/*.test.mjs scripts/store-continuity.test.cjs`: 39 passed. Tests include exact submission config restoration after success/failure, separate old runtimes, long histories, conflicting build metadata, legacy-runtime rejection, and exact finished-artifact checks.

`node deploy/mobile/verify-fingerprint.cjs` exercises the real installed Expo runtime resolver. Repeated resolution and an actual temporary JavaScript edit retain the runtime; a native plugin edit changes it; restoring sources restores the original hash. All source edits are reverted. See `fingerprint-verification.json`. Jenkins runs this check before release.

The real authenticated `eas fingerprint:generate --build-profile production --platform ios --json --non-interactive` command and `expo-updates runtimeversion:resolve --platform ios --workflow managed` returned the same hash for the candidate. Production release preflight and brand verification passed. Native delivery and a real OTA publish are verified separately after merge; local checks are not claimed as publication.

Reference: [Expo runtime versions](https://docs.expo.dev/eas-update/runtime-versions/).

## Migration build environment correction

EAS build 20 (`50da5496-bef1-477d-b7ad-e64a9a1fb336`) stopped before compilation
because the remote runtime differed. The EAS fingerprint diff identified only
one hashed difference: `expoConfig.android.intentFilters` was empty remotely.
Jenkins supplied `EXPO_PUBLIC_TALOS_WEBAPP_URL`, while the production EAS profile
did not. The additional generated `ios` source had a null hash and did not
contribute to the runtime. No native directory exclusion or hash override was added.

The production profile now carries the public server URL, app URL, and install
command used by Jenkins. A configuration regression test compares the worker
and runner inputs; the actual Expo runtime verification also resolves both
environments and requires equality before any cloud build.

Validation on 2026-09-07:
- 40 mobile release/store-continuity tests passed.
- Real Expo runtime resolver verified repeatability, worker/runner equivalence,
  JavaScript-only compatibility and native plugin invalidation.
- Isolated pnpm install runtime: `86d99034771c86a8c2ff5ad743c06e0650f848f6`.
- Real `expo prebuild --platform ios --no-install` retained exactly that runtime
  before/after generation. Generated native output was removed afterward.
- Replacement cloud build and production OTA delivery remain separate required
  deployment checks; these local checks do not claim a successful store delivery.

## Completed build 21 artifact verification

EAS completed build `eb275718-df2a-4779-9e3f-da96eba575bc` for commit
`fe72439179e35cbc65ed174dfef88331a6b0cc09`. Remote configuration and the bundled
fingerprint both resolve to `86d99034771c86a8c2ff5ad743c06e0650f848f6`. Jenkins
33 stopped before submission because the older IPA verifier compared Expo's
`file:fingerprint` sentinel literally. The verifier now follows the installed
Expo SDK's `UpdatesConfig.swift` resource lookup and checks the actual hash.

The real downloaded IPA passed the complete corrected continuity/signature gate;
see [the sanitized report](build21-ipa-verification.json). Its SHA256 is
`50a1a477dfa6f51d70a89e65cdb62b5f2f2732f4db94b74eed8ba6b09f4515cc`.
The regression suite covers missing/wrong/malformed resources and retains literal
runtime support. Retry selection uses actual Git ancestry/diffs and exact EAS
metadata, preserving all submission checks without rebuilding unchanged app code.
