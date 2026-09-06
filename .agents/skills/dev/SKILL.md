---
name: dev
description: >
  Local development guide for the Talos monorepo. How to build, install,
  test, and run the CLI, server, mobile app, and desktop (Tauri) locally.
  Use when the user types /dev, asks how to "build", "start dev", "install
  locally", or "run the ___ package".
---

# /dev - Local Development

Talos is a pnpm monorepo. Everything uses pnpm workspaces — do not use `npm` or `yarn` directly.

## First-time setup

```bash
pnpm install                       # installs deps for every package
pnpm --filter talosapp cli:install    # builds talos-cli + links it as the global `talos` binary
```

`cli:install` replaces whatever `talos` is on your PATH (npm-installed or not) with a symlink to `packages/talos-cli/`. Daemon is restarted as part of the script. Uses `~/.talos/` — same as production.

To undo: `npm unlink -g talosapp && npm i -g talosapp@latest`.

## Packages

    packages/talos-cli     # the `talos` CLI and daemon, published to npm
    packages/talos-server  # Node + Prisma server, deployed using the root deployment configuration
    packages/talos-app     # Expo app: iOS, Android, web, Tauri desktop
    packages/talos-agent   # agent runtime
    packages/talos-wire    # shared Zod schemas + wire types

## talos-cli

    packages/talos-cli
    scripts in package.json:
      typecheck      # tsc --noEmit
      build          # rm -rf dist && tsc --noEmit && pkgroll
      test           # build + vitest run
      cli:install    # build + stop daemon + npm link + start daemon
      prepublishOnly # pnpm test (runs build inside test)
      postinstall    # unpacks difft + rg binaries into tools/unpacked/

Work loop:

```bash
pnpm --filter talosapp cli:install   # rebuild + relink + restart daemon
talos daemon status               # confirm your build is running
talos doctor                      # list all talos processes
tail -f ~/.talos/logs/$(ls -t ~/.talos/logs/ | head -1)
```

Run a single test file quickly:

```bash
pnpm --filter talosapp exec vitest run src/path/to/file.test.ts
```

Unit-only (fast, ~1 min):

```bash
pnpm --filter talosapp exec vitest run --project unit
```

Integration tests hit real APIs and are flaky — run on demand, never in the release gate.

### Dev data sandbox (optional)

`talos` reads `TALOS_HOME_DIR` to override `~/.talos/`. To run two versions side-by-side without touching your prod auth:

```bash
TALOS_HOME_DIR=~/.talos-dev talos daemon start
TALOS_HOME_DIR=~/.talos-dev talos auth
```

Point at a local server the same way:

```bash
TALOS_SERVER_URL=http://localhost:3005 talos daemon start
```

## talos-server

```bash
pnpm --filter @ahmadposten/talos-server standalone:dev   # localhost:3005, embedded PGlite, no Docker
```

App auto-reloads on source changes. Point the CLI or the Expo app at it with `TALOS_SERVER_URL=http://localhost:3005` / `EXPO_PUBLIC_TALOS_SERVER_URL=...`.

## talos-app (Expo)

```bash
pnpm --filter talos-app start           # expo start (Metro bundler)
pnpm --filter talos-app ios:dev         # iOS simulator, development variant
pnpm --filter talos-app android:dev
pnpm --filter talos-app web             # web build, served locally
pnpm --filter talos-app tauri:dev       # macOS desktop app
```

Variants:

    development    com.ahposten.talos.dev       # hot reload, internal
    preview        com.ahposten.talos.preview   # OTA / beta testing
    production     existing store identifier  # In-place App Store update; store-identity.cjs

### Rebuild and reinstall the desktop .app

When the user asks to "rebuild the desktop app", "kill the running one and reinstall", or anything in that shape — do all four steps in order, do not stop after building.

Variants → product name → build script:

    production    Talos.app           pnpm --filter talos-app tauri:build:production
    preview       Talos (preview).app pnpm --filter talos-app tauri:build:preview
    dev           Talos (dev).app     pnpm --filter talos-app tauri:build:dev

Build output for all variants:

    packages/talos-app/src-tauri/target/release/bundle/macos/<ProductName>.app

If the variant is ambiguous, check what's running with `ps aux | grep "/Applications/.*Talos" | grep -v grep` and match. Production is the default.

Steps (substitute `$NAME` with the product name, e.g. `Talos` or `Talos (dev)`):

```bash
# 1. build (slow: ~3–10 min, expo web export then cargo release build)
pnpm --filter talos-app tauri:build:production

# 2. quit the running app gracefully (no-op if not running)
osascript -e 'tell application "$NAME" to quit' || true

# 3. replace the installed bundle
rm -rf "/Applications/$NAME.app"
cp -R "packages/talos-app/src-tauri/target/release/bundle/macos/$NAME.app" /Applications/

# 4. relaunch
open -a "$NAME"
```

Notes:
- Run the build in the background (`run_in_background: true` on Bash) and poll the output file. It prints `Finished \`release\` profile` near the end.
- `osascript ... to quit` is graceful — it gives the app a chance to flush state. Only fall back to `pkill -f "/Applications/$NAME.app/Contents/MacOS/app"` if the quit hangs.
- Do NOT skip the `rm -rf` before `cp` — `cp -R` over an existing `.app` merges directories and leaves stale files.
- If macOS Gatekeeper complains on relaunch, `xattr -dr com.apple.quarantine "/Applications/$NAME.app"` clears it. Local builds are unsigned.

## talos-app-logs (remote log receiver)

```bash
pnpm --filter talos-app-logs dev       # starts on http://0.0.0.0:8787
```

Receives POST requests to `/logs` from the mobile app's patched console (see `consoleLogging.ts`).
Logs to stdout and `~/.talos/app-logs/<timestamp>.log`.

To connect: set the log server URL in the app's dev settings to `http://<LAN_IP>:8787`.
The app's `consoleLogging.ts` sends all console.log/warn/error to this endpoint when configured.

Console output must be enabled in the app (dev/preview variants default on, production defaults off,
togglable from the dev settings screen).

## Cross-cutting

- **Hoisted deps:** pnpm hoists node_modules to the repo root. `packages/*/node_modules/` is mostly empty. Node's resolution walks up, so imports work transparently.
- **Workspace deps:** `"@ahmadposten/talos-wire": "workspace:*"` resolves to `packages/talos-wire/` — edits are picked up live.
- **`$npm_execpath`:** legacy; talos-cli uses `pnpm` literally. Windows cmd.exe doesn't expand `$VAR`.
- **Build before tests:** tests spawn the built CLI binary (for daemon integration), so `pnpm test` runs `build` first. Do not remove.

## Releasing

Do not publish by hand. Use `/release` — it handles npm publish, git tags, GitHub releases, and the smoke check.

## Troubleshooting

    talos: command not found     → pnpm --filter talosapp cli:install
    daemon won't start           → talos daemon stop; rm ~/.talos/daemon.state.json.lock; talos daemon start
    wrong `talos` version        → which talos && ls -la $(which talos) — confirms where it resolves to
    tools/unpacked missing       → pnpm install (postinstall re-extracts)
    stale deps after branch swap → pnpm install (pnpm is picky about lockfile drift)

## Rules

- Never use `npm install` or `yarn install` — only pnpm.
- Never add a `dev` / `cli` tsx-based script back to talos-cli. The build step is not optional — daemon spawns the built binary and would desync.
- Never bring back `release-it`. Releases go through `/release`.
- Never introduce `~/.talos-dev` as a default. It exists as an opt-in via `TALOS_HOME_DIR`, nothing more.
