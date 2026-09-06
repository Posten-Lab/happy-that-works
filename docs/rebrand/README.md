# Talos identity and verification

Talos is the product name across web, iOS, Android, desktop, the CLI, and the agent runtime. The command is `talos`; companion commands are `talos-mcp` and `talos-agent`. Workspace packages and build paths use `talos-*`.

## Visual identity

Use the supplied Talos artwork without redrawing it. Bronze accents, charcoal surfaces, warm ivory backgrounds, restrained corners, and a spaced uppercase wordmark distinguish the interface. Keep status, permission, and diff colors semantic. Both light and dark themes, narrow screens, keyboard navigation, and text scaling remain supported.

## Safety boundaries

- Work in `codex/talos-rebrand`, based on the local checkpoint of pre-existing work. The original checkout and its uncommitted files remain untouched.
- Install Talos alongside the previous product by default. Use new application identifiers, `talos://` links, `.talos` state, and separate daemon identities.
- Never silently copy credentials, change encryption contexts, rewrite stored conversation content, or stop another product's daemon. Existing accounts can be linked or restored explicitly.
- Preserve encryption derivation constants and accept stored metadata from earlier clients. Changes to brand identity must not change account keys or make attachments unreadable.
- Keep upstream copyright notices intact. Historical research and license notices are not product branding.
- Production endpoints, store listings, Firebase configuration, signing, and OTA identity must belong to Talos. Do not ship another product's credentials or redirect to its services.
- Until production configuration is supplied, validate an isolated local installation. Package publication and deployment require a configured Talos release, rather than invented service addresses.

## Acceptance checks

1. No previous brand in product labels, translations, CLI help, generated app metadata, first-party runtime asset names, or distribution commands.
2. All launcher, splash, header, browser, notification, and desktop icons derive from the supplied bundle; old logotypes are removed.
3. Builds resolve renamed workspaces and entry points from a frozen lockfile.
4. Encryption compatibility, metadata compatibility, isolated state, login links, daemon spawning, and server configuration have meaningful regression checks.
5. App, CLI, agent, wire, and server suites and type checks pass. Web and native exports succeed; browser checks cover light/dark desktop and mobile widths, navigation, and account setup against an isolated relay.
6. Release configuration cannot accidentally target the previous product's stores, update project, or hosted services.

## Reviewed rebrand checkpoint — 6 September 2026

All 1,944 automated checks passed: app 734, CLI 761, agent 227, wire 29, server 83, desktop 102, and release/render/OTA scripts 8. App and desktop type checks, server build, frozen dependency installation, brand audit, and staged whitespace checks passed. The wire suite rebuilds its output and must finish before consumer suites start.

Release builds succeeded for web, an ad-hoc signed iOS simulator app, Android arm64 APK, Tauri macOS app, Electron, and a Linux arm64 standalone container. Native store signing and remote CI were not exercised.

Interactive verification used synthetic accounts only. Browser checks covered desktop and phone layouts, light/dark themes, account creation, settings, CLI pairing, and decrypting a message sent by the paired terminal. Dedicated iOS and Android devices passed account flows; iOS URI pairing completed through the actual terminal UI. An isolated CLI daemon completed start/status/stop. Clean local package installation and the packaged relay/web application passed smoke checks. The container passed health, identity, and database-backed authentication checks. Tauri launched with the new application identity; host permissions prevented capturing its native window.

Screenshots and their SHA-256 manifest are in [evidence](evidence/screenshots.json). The supplied artwork has a separate provenance manifest in `assets/talos`.

The original checkout's 26 modified/untracked user files matched the pre-work backup. No production workload, real account, npm publication, store release, or upstream repository was changed at this checkpoint.

## Authorized production rollout

The user subsequently authorized `talosapp.ai`, npm publication, and migration of ongoing accounts and sessions. Deployment must add Talos endpoints alongside the current services, share the existing database, keys, Redis, and object storage, and retain the old endpoints for running clients. Migration must preserve account encryption, leave source credentials unchanged, and never stop existing daemons. Production verification and any remaining external access requirements will be recorded separately.


The [production rollout record](rollout.md) contains the verified session migration, deployed image digests, final suite counts, and remaining AWS/npm access requirements.
