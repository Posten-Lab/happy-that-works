---
name: release
description: >
  Release Talos CLI, agent, wire, self-host server, web, or native apps. Use when
  the user asks to release, publish, deploy, or ship a component.
---

# Talos release

Use the user's requested targets and existing authorization. Resolve only choices that remain unset. Prepare and verify the actual artifacts before publication or traffic changes.

## Package identities

| Workspace | npm package | Installed command |
| --- | --- | --- |
| `packages/talos-wire` | `@ahmadposten/talos-wire` | Library |
| `packages/talos-agent` | `@ahmadposten/talos-agent` | `talos-agent` |
| `packages/talos-server` | `@ahmadposten/talos-server` | `talos-server` |
| `packages/talos-cli` | `talosapp` | `talos` and `talos-mcp` |

The npm publisher is `ahmadposten`; the registry is `https://registry.npmjs.org`. The unrelated unscoped `talos` package belongs to another publisher. Check `npm whoami`, current package metadata, and the requested channel before publishing.

## Build and verification

1. Change versions directly in the relevant `package.json` **before** building. The CLI bundle embeds its version. Do not use `npm version` with workspace protocols.
2. Run `pnpm install --frozen-lockfile`, then build/test wire first. Its test script rebuilds and removes `dist`, so no consumer build/test may run concurrently.
3. Run each intended package's complete `prepublishOnly` chain. The server needs Bun on PATH and rebuilds the production web export. Use `APP_ENV=production` and the intended Talos service configuration.
4. Run `pnpm verify:brand` and `pnpm verify:packaged`. The package check covers isolated, hoisted, and cached installs, CLI/agent versions, relay startup, database-backed authentication, and the bundled web app.
5. Inspect packed package metadata, file lists, licenses, and workspace dependency resolution. Do not include credentials, uncompressed tool caches, or local state.

The server owns the self-host runtime and bundled web app. Keep `tools/server` and `tools/webapp` out of the CLI tarball. Its standalone Prisma client lives inside the server package so package-manager caches preserve it. Source-mode deployments continue to use the normal generated `@prisma/client`.

## Publish

The root release command defaults to a local plan and never prompts or invokes `release-it`:

```sh
pnpm release all --plan
pnpm release wire --publish
```

Targets are `wire`, `server`, `agent`, `cli`, and `all`; `--dry-run` also prints only a local plan. `--publish` is required to upload. `all` publishes wire, server, agent, then CLI sequentially. Use `--tag next` (or the requested tag) for a non-default channel. Package-local wire/agent `release` scripts dispatch to these same fixed root targets.

The command verifies the npm publisher, registry, package identities, unpublished versions, and required wire dependency before uploading. Server publication requires `APP_ENV=production` and Bun on PATH. Every upload runs `pnpm publish` with its complete prepublish hooks; the command does not bump versions, create git tags, push branches, or retry failed uploads. Complete the build/packaging checks above before choosing `--publish`.

Use the root release wrapper so all subprocesses use the canonical credential. **The wrapper uses `pnpm publish`, never `npm publish`, and never passes `--ignore-scripts`.** Prepublish scripts rebuild, test, and stamp the version immediately before upload.

If an upload fails, inspect registry metadata before retrying: a package version is immutable and the upload may already have succeeded. Authentication failures need the account's required 2FA or an appropriately configured token; do not weaken account security to bypass them.

The approved token is already stored at `~/.config/talos/npm-publish.npmrc` on the operator MacBook. Use it for future releases; do not fall back to the general npm login or ask for another token while it remains valid. The release wrapper selects this private file automatically and sets both npm userconfig spellings. For CI only, bind the same approved credential as a private file and set its absolute path in `TALOS_NPM_USERCONFIG`. Current Jenkins deployment jobs do not publish npm packages. See [the canonical publishing runbook](../../../docs/rebrand/npm-publishing.md).

For rotation, use `python3 scripts/configure-npm-publishing.py` to enter a replacement with hidden input. This updates only the private publishing file and preserves the existing npm login. The token must grant package read/write access and satisfy the registry's publishing 2FA requirement; successful `whoami` alone does not verify those permissions. Never put token values in chat, shell arguments, documentation, or tracked files.

After publication, verify registry version/dist-tags and perform a real install into an isolated prefix. Check `talos --version` and `talos-agent --version` against the published versions. Metadata alone does not verify bundle contents. Install the global `talos` command only within the user's requested scope, without restarting existing sessions.

Repository tags and hosted releases are separate actions. Check the destination remote and user authorization before pushing. Do not force-push tags or publish against an inherited upstream remote. Use component tags such as `cli-X.Y.Z`, not a monorepo-wide bare `vX.Y.Z`.

## Web and API

The Talos web origin is `https://talosapp.ai`; the API used by web/mobile/CLI is `https://api.talosapp.ai`. Use the reviewed operator configuration in `deploy/talos-production`, or render the general root deployment templates for a new environment. Validate the active cloud account, DNS zone, image digests, TLS, and target namespace before changing traffic.

For an existing installation, preserve PostgreSQL/PGlite data, file storage, Redis transport, master secret, accounts, and active processes. Add the new hostnames alongside existing endpoints until all active clients have migrated. Do not substitute a fresh datastore or rotate the master secret during a branding rollout. Take verifiable backups and retain a rollback route.

See `docs/rebrand/migration.md` for explicit account and session-key import. Migration must preserve original files and running processes; do not copy a live daemon state into the new home or start two daemons with the same machine identity.

## Native and OTA

Use `packages/talos-app/app.config.js`, `store-identity.cjs`, `.env.talos.example`, and `scripts/verify-release-config.cjs` as the source of native identities and signing configuration. Production retains the existing store bundle identifier in `store-identity.cjs` so installed apps receive an update and preserve their accounts. Preview and development use `com.ahposten.talos.preview` and `com.ahposten.talos.dev`.

A native/store or OTA release requires the existing user-owned EAS project, owner, signing/store configuration, and the user's selected target/channel. Its immutable project slug and store identifier are compatibility values described in `docs/rebrand/store-upgrade.md`; the installed name and artwork are Talos. Do not reuse unrelated upstream Apple, Firebase, Expo, voice, or payment credentials. Legacy Talos binaries used runtime `talos-1`. New binaries use Expo’s fingerprint runtime policy; migrating from the legacy runtime requires one native update. Subsequent OTA releases must match a finished production binary’s fingerprint-derived runtime and native fingerprint. Keep temporary submission configuration out of build/update fingerprinting; prepare it only after building and restore `eas.json` afterward. Use the guarded mobile pipeline and submit its exact build ID. Native build, TestFlight delivery, and public App Store review are separate actions.

Update the in-app changelog with concise user-visible Talos changes, then generate its JSON through `sources/scripts/parseChangelog.ts`. Keep implementation history and release evidence in the repository release record.
