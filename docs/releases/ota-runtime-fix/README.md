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
