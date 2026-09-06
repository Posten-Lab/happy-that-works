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

Publish wire first, then server/agent, then CLI. From each package directory:

```sh
pnpm publish --access public --tag latest --no-git-checks
```

Use the requested tag if it differs. **Use `pnpm publish`, never `npm publish`, and never pass `--ignore-scripts`.** Prepublish scripts rebuild, test, and stamp the version immediately before upload.

If an upload fails, inspect registry metadata before retrying: a package version is immutable and the upload may already have succeeded. Authentication failures need the account's required 2FA or an appropriately configured token; do not weaken account security to bypass them.

For an operator-supplied granular token, use `python3 scripts/configure-npm-publishing.py` to enter it with hidden input. This writes only `~/.config/talos/npm-publish.npmrc` with private permissions and preserves the existing npm login. Set `NPM_CONFIG_USERCONFIG` to that absolute path for identity checks and publication. The token must grant package read/write access and satisfy the registry's publishing 2FA requirement; successful `whoami` alone does not verify those permissions. Never put token values in chat, shell arguments, documentation, or tracked files.

After publication, verify registry version/dist-tags and perform a real install into an isolated prefix. Check `talos --version` and `talos-agent --version` against the published versions. Metadata alone does not verify bundle contents. Install the global `talos` command only within the user's requested scope, without restarting existing sessions.

Repository tags and hosted releases are separate actions. Check the destination remote and user authorization before pushing. Do not force-push tags or publish against an inherited upstream remote. Use component tags such as `cli-X.Y.Z`, not a monorepo-wide bare `vX.Y.Z`.

## Web and API

The Talos web origin is `https://talosapp.ai`; the API used by web/mobile/CLI is `https://api.talosapp.ai`. Use the reviewed operator configuration in `deploy/talos-production`, or render the general root deployment templates for a new environment. Validate the active cloud account, DNS zone, image digests, TLS, and target namespace before changing traffic.

For an existing installation, preserve PostgreSQL/PGlite data, file storage, Redis transport, master secret, accounts, and active processes. Add the new hostnames alongside existing endpoints until all active clients have migrated. Do not substitute a fresh datastore or rotate the master secret during a branding rollout. Take verifiable backups and retain a rollback route.

See `docs/rebrand/migration.md` for explicit account and session-key import. Migration must preserve original files and running processes; do not copy a live daemon state into the new home or start two daemons with the same machine identity.

## Native and OTA

Use `packages/talos-app/app.config.js`, `.env.talos.example`, and `scripts/verify-release-config.cjs` as the source of native identities and signing configuration. Current bundle identifiers are `com.ahposten.talos`, `com.ahposten.talos.preview`, and `com.ahposten.talos.dev`.

A native/store or OTA release requires the matching Talos-owned EAS project, owner, signing/store configuration, and the user's selected target/channel. Do not reuse historical upstream Apple, Firebase, Expo, voice, or payment credentials. The OTA package scripts run the release preflight; use those scripts rather than bypassing it with a raw update command. Native build and submission are distinct targets from deploying the mobile API.

Update the in-app changelog with concise user-visible Talos changes, then generate its JSON through `sources/scripts/parseChangelog.ts`. Keep implementation history and release evidence in the repository release record.
