# Talos rollout — 6 September 2026

The rebrand and local account migration are implemented. Talos web and API deployments are healthy alongside the existing production services. Public DNS/TLS activation and npm publication are awaiting external account access.

## Session continuity

The original checkout and its 26 pre-existing modified/untracked files were preserved. Production resource definitions, secrets, PostgreSQL data and 106 stored objects were backed up privately before rollout. The 263 MB database backup restored successfully in an isolated container with all 190 sessions, including eight marked active.

This machine's account credentials were imported byte-for-byte into `~/.talos` with a separate machine identity. Its 40 cached session keys were imported into a private account-bound index; no daemon ownership or process state was copied. All 40 matching sessions decrypted through both the original API and the new Talos API, and the actual historical resolver succeeded. Twenty-eight currently include provider resume identifiers. Uncached history remains available through the fully authenticated app; CLI access to uncached encryption keys requires full account authentication.

An encrypted, read-only RPC travelled through the new API to the original running daemon and returned its existing path-access restriction. No session start, resume, stop, or daemon restart was requested during that verification. The original daemon remained alive, and all seven original production pods retained their identities and restart counts.

New migrations automatically import available session keys. Later `talos migrate --import-session-keys` calls preserve existing keys, merge newly cached IDs under an exclusive lock, and reject conflicting keys. Ordinary registration and relay-setting changes do not block these imports. See [migration details](migration.md).

The app's account linking defaults to Talos. Selecting **Connect an existing installation** produces a compatible QR code that an already signed-in older app can approve. A browser test verified that this flow decrypted exactly the same synthetic account secret and entered the Talos workspace. This allows migration without exposing a recovery secret in a URL or rewriting account data.

## Local command

The verified CLI candidate is installed at `~/.local/share/talos/releases/1.0.0-candidate-02cb264efff1`. Both `~/.local/bin/talos` and `talos-mcp` point into that immutable installation; `talos --version` reports 1.0.0. Only CLI and wire packages are installed there. The command uses the migrated account and currently retains its working relay until Talos DNS is activated.

Activation preserved the existing command, credentials, settings, key index, receipt and running daemon. No new daemon was started. When switching to a registry installation, remove only activation links still pointing to this recorded candidate; retain its release directory while any running process uses it. Its private installation record and tarballs are retained in the release directory.

## Deployed components

Only the following new resources were created in the existing application namespace: `talos-api` Deployment/Service and `talos-web` Deployment/Service. Each deployment has two healthy replicas, separate selectors and NodePorts 32002/32001. They share the existing database, Redis, master secret and object storage. No database migration or datastore rollout was performed.

Immutable images:

- API: `ahmadposten/talos-server@sha256:fa3c0d6d68600acc3fc8fc668ad47c5c1e03f586da882beb1fff22fc529d39ae`
- Web: `ahmadposten/talos-web@sha256:6974d2e225cf2777cff504d1a6d1c0b98f54b4667681b9121e31a0addb8bff15`

Both images were built for Linux amd64. Their checked build contexts, hashes and logs are retained under `/tmp/talos-evidence`. The API snapshot predates npm-only Prisma packaging support; its source runtime and schema are unchanged and its Prisma generation and live account checks passed.

The new HTTP certificate-challenge route is installed on the existing edge and was verified externally with explicit host resolution. nginx was validated and gracefully reloaded. Existing host configurations were preserved. The API currently retains the working object-storage hostname until Talos DNS/TLS is available; the final rendered manifest switches it to `files.talosapp.ai` afterward.

## Publication preparation and remaining access

Prepared packages are `talosapp@1.0.0`, `@ahmadposten/talos-wire@0.1.0`, `@ahmadposten/talos-agent@0.1.0`, and `@ahmadposten/talos-server@1.0.0`. The command remains `talos`. The unscoped `talos` package belongs to another publisher.

Actual tarballs passed clean isolated, hoisted, and cached installations with CLI/agent version checks, packaged tools, standalone relay, database authentication and bundled web startup. CLI-only installation was separately checked without the optional server or agent packages. Packaging checks also found and fixed version output falling through to authentication and Prisma clients missing from cached installations.

No npm package was published. The registry rejected the first wire-package publication with HTTP 403, requiring two-factor authentication or a granular publishing token with bypass-2FA enabled. A second attempt used a newly supplied token, which authenticated as `ahmadposten`; pnpm's use of the intended private configuration was also verified. The wire prepublish builds and all 29 tests passed, but publication returned the same 2FA-related HTTP 403. A subsequent registry lookup returned 404 for the requested version, confirming that it had not been published. No other packages were attempted.

Publishing authorization must be corrected before another attempt. The [local token setup helper](../../scripts/configure-npm-publishing.py) accepts replacement credentials without displaying them. Publish wire first, then server/agent, then CLI; retain all prepublish checks. Server publication needs the verified Bun executable available on PATH.

The default AWS profile resolves to IAM user `quietplan-backend` and is denied Route53 access. `talosapp.ai` has public Route53 delegation but no A records yet. Use an authorized identity for its hosted zone, then follow the [additive production runbook](../../deploy/talos-production/README.md) and [prepared DNS change batch](../../deploy/talos-production/route53-records.json).

Completion still requires DNS records, a valid Talos TLS certificate, the files/CORS route, final API storage-host configuration, HTTPS/browser/attachment checks, npm publication and a real registry installation check. After the new URLs pass account-continuity checks, update only the Talos installation's saved URLs. Keep original endpoints available for running clients.

## Validation

Automated suites passed: app 737, CLI 797, agent 230, wire 29, server 83, desktop 102, and release/render/OTA scripts 8 — **1,986 checks**. Relevant type checks, frozen installation, branding and whitespace checks also passed. Web export, signed iOS simulator Release build and Android arm64 Release APK and Tauri macOS bundle succeeded with the final account-linking code. Native store signing and store publication were not performed.

Earlier interactive checks covered light/dark desktop and phone layouts, browser and native CLI pairing, fresh accounts, settings, an encrypted synthetic session message, and an isolated daemon lifecycle. The final QR migration flow adds a verified older-client approval path. [Screenshots and hashes](evidence/screenshots.json) contain synthetic accounts only.

Build orchestration must finish wire rebuilds before consumer tests. Concurrent native Metro builds need separate temporary/cache directories; an Android cache collision was resolved by using its own temporary directory and rebuilding successfully.

A [sanitized verification manifest](evidence/verification.json) records suite totals, package hashes, session decryption and process-preservation results.
