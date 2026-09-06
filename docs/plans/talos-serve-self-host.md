# `talos server` — bundled self-host mode

Status: historical design. The current distribution separates `talosapp` from `@ahmadposten/talos-server`; follow [the server installation guide](../../packages/talos-server/README.md) for the supported package layout.

## Goal

Ship a zero-network, fully self-hosted Talos in the regular `npm i -g talosapp` package. One foreground command — `talos server` — runs the sync server + web app on `localhost` and writes the local URL into `~/.talos/settings.json`. Every other Talos process (daemon, `talos claude`, etc.) reads that URL from settings. No analytics, no external endpoints, no extra installs.

## Bootstrap (the v1 user flow)

```bash
# Terminal 1 — start the server (blocks; Ctrl-C to stop)
talos server

# On first start, prints:
#   Wrote settings.serverUrl = http://127.0.0.1:3005
#   Talos server listening at http://127.0.0.1:3005
#   Open http://127.0.0.1:3005 in your browser

# Terminal 2 — daemon and CLI now target localhost (read from settings)
talos daemon start
talos claude

# Web UI at http://127.0.0.1:3005 — pair / start sessions from there
```

That's it. No daemon flags, no `--serve` flag on `daemon start`. Two commands, both already in the user's muscle memory shape.

## Design decisions

### 1. `talos server` runs the server synchronously in the foreground

- No daemonization, no spawn, no background process management.
- Ctrl-C stops it. If it dies, things break — that's the point.
- "Should I daemonize this?" is a v2 question. v1 leans on the user to keep a terminal open (or run it under their own systemd unit / tmux / whatever).

### 2. Single settings field: `settings.serverUrl`

Add to `Settings` in `packages/talos-cli/src/persistence.ts:37`:

```ts
interface Settings {
  ...existing...
  serverUrl?: string;   // e.g. 'http://127.0.0.1:3005' — when set, used by all talos processes
}
```

That's the entire persistence surface. No nested `selfHost: { enabled, port, host, dataDir }` object.

- `talos server` writes this on startup.
- `talos server --port 8080 --host 0.0.0.0` writes `http://0.0.0.0:8080` (or printed LAN IP).
- `talos server --reset` clears the field and exits without starting the server.
- Users can also just edit `~/.talos/settings.json` by hand.

### 3. No fallback. Period.

If `settings.serverUrl` is set, everything uses it. If the server is dead, requests fail loudly. We do **not** auto-fall-back to `api.cluster-fluster.com`, do **not** auto-retry against another URL, do **not** silently switch modes.

Rationale: self-host users explicitly opted in. Silent fallback to the public server is the worst possible failure mode — exfiltrates data the user thought was staying local. Fail closed.

### 4. URL precedence (one line of new logic)

`packages/talos-cli/src/configuration.ts:32` becomes:

```ts
this.serverUrl =
  process.env.TALOS_SERVER_URL              // env var still wins (debug/override)
  || settings.serverUrl                     // NEW — from ~/.talos/settings.json
  || 'https://api.cluster-fluster.com';     // default unchanged
```

For existing users: `settings.serverUrl` is `undefined` → falls through to default. **No change.**

### 5. Web app — same-origin trick

Talos-server serves the bundled webapp on its own port. At serve time, the static handler rewrites `index.html` to inject:

```html
<script>window.__TALOS_CONFIG__ = { serverUrl: location.origin, disableAnalytics: true };</script>
```

And `packages/talos-app/sources/sync/serverConfig.ts:10-14` gets one extra fallback:

```ts
export function getServerUrl(): string {
  return serverConfigStorage.getString(SERVER_KEY) ||
         (globalThis as any).__TALOS_CONFIG__?.serverUrl ||  // NEW
         process.env.EXPO_PUBLIC_TALOS_SERVER_URL ||
         DEFAULT_SERVER_URL;
}
```

Production `<configured Talos web host>` never has `__TALOS_CONFIG__` set → no behavior change there. Self-host injects it → web calls its own origin. One bundle, two behaviors.

### 6. Daemon needs no changes

Because the daemon reads `configuration.serverUrl` like every other entry point, and `configuration` now reads from `settings.serverUrl`, the daemon Just Works™ when a user has run `talos server`. Zero code in `daemon/run.ts`. (v2 can add daemon-managed lifecycle if needed.)

## Disabling analytics (defense in depth)

### State of the world today
- **talos-cli, talos-agent, talos-server: no analytics at all** (verified — see Audit reference below).
- **talos-app (web + mobile): PostHog only**, already gated: `tracking = config.postHogKey ? new PostHog(...) : null` (`packages/talos-app/sources/track/tracking.ts:4`). Every call site is `tracking?.capture(...)`, so absence of the key already short-circuits everything.

### Three-layer kill switch

The existing gate is the key. We add two more layers so analytics is impossible in self-host mode regardless of build flags or user mistakes.

**Layer 1 — Existing key gate (already works).** Build the package without `EXPO_PUBLIC_POSTHOG_API_KEY` → `config.postHogKey` is undefined → `tracking` is `null` → no PostHog instance, no events, no network.

**Layer 2 — Runtime env var kill switch (NEW).** Patch `tracking.ts`:

```ts
import { config } from '@/config';
import PostHog from 'posthog-react-native';

const analyticsDisabled =
  process.env.EXPO_PUBLIC_DISABLE_ANALYTICS === '1' ||
  process.env.EXPO_PUBLIC_DISABLE_ANALYTICS === 'true' ||
  (globalThis as any).__TALOS_CONFIG__?.disableAnalytics === true;

export const tracking = (analyticsDisabled || !config.postHogKey)
  ? null
  : new PostHog(config.postHogKey, {
      host: 'https://us.i.posthog.com',
      captureAppLifecycleEvents: true,
    });
```

Two ways to flip it:
- `EXPO_PUBLIC_DISABLE_ANALYTICS=1` at build OR runtime (Expo public env vars are inlined into the bundle, but `process.env` lookups remain queryable on web).
- `window.__TALOS_CONFIG__.disableAnalytics = true` injected by talos-server's static handler.

**Layer 3 — Self-host mode auto-disables.** The HTML rewrite in `talos server` always includes `disableAnalytics: true`:

```ts
injectHtmlConfig: { serverUrl: '/', disableAnalytics: true }
```

So any webapp served by `talos server` has analytics off regardless of what was baked into the bundle at build time. If a user's enterprise rebuilds talos with their own PostHog key (intentionally), they still can't accidentally leak when they `talos server` — the script-tag injection wins.

### What this does NOT do (yet, optional)

- Doesn't remove the `posthog-react-native` dependency from the bundle. Code is still there, just unreachable.
- Truly auditable "no PostHog code at all" would need a build-time stub swap (e.g. Metro resolver alias `tracking.ts` → `tracking.empty.ts`). Listed as a v2 idea.

### CLI / server / agent — nothing to add
No analytics code exists. Nothing to disable. (If we ever add CLI telemetry in the future, the same env var name `TALOS_DISABLE_ANALYTICS=1` should be the kill switch — drop `EXPO_PUBLIC_` prefix.)

## How current users are unaffected

Three guarantees, all hinging on `settings.serverUrl === undefined` for existing users:

1. **Settings default**: optional field, missing in existing `settings.json`. `readSettings()` returns `undefined`.
2. **Configuration URL**: middle clause in precedence chain is `undefined` → falls through to current default. Byte-identical behavior.
3. **Web app**: `window.__TALOS_CONFIG__` only ever set by the static handler in self-host mode. Production builds at `<configured Talos web host>` never see it.

The only real cost: **~30 MB extra in the npm tarball** for the bundled webapp + pglite wasm + migrations. Paid by all users, even non-self-hosters. Acceptable on a 121 MB package; mitigated by the orthogonal `difft` cleanup (could free ~70 MB).

## Tarball layout

```
talos@1.x.x/
├── dist/                        existing — bundled JS (now imports talos-server)
├── bin/                         existing
├── tools/                       existing — ripgrep + difft binaries
├── server-assets/               NEW (~30 MB total)
│   ├── webapp/                  pre-built talos-app web export (~28 MB)
│   │   ├── index.html
│   │   ├── _expo/
│   │   └── assets/
│   ├── pglite/
│   │   ├── pglite.wasm
│   │   └── pglite.data
│   └── migrations/              Prisma SQL migration files
├── scripts/                     existing
└── package.json                 + "server-assets" in files array
```

Runtime path resolution from bundled `dist/index.{cjs,mjs}`:

```ts
const ROOT          = dirname(dirname(fileURLToPath(import.meta.url)))
const WEBAPP_DIR    = join(ROOT, 'server-assets', 'webapp')
const MIGRATIONS    = join(ROOT, 'server-assets', 'migrations')
const PGLITE_WASM   = join(ROOT, 'server-assets', 'pglite', 'pglite.wasm')
```

PGlite gets the wasm path passed explicitly so bundling doesn't break the lookup.

## Implementation sketch

### New files

**`packages/talos-cli/src/commands/server.ts`** (~80 LOC)
```
talos server                      start server, write URL, block
talos server --port N             custom port
talos server --host 0.0.0.0       bind for LAN/mobile
talos server --reset              clear settings.serverUrl, exit
talos server --no-persist         start server but don't touch settings (test mode)
```
Flow: parse args → `updateSettings({ serverUrl })` (unless `--no-persist`) → `migrate(...)` → `startServer(...)` → log URL → await server close on SIGINT/SIGTERM.

**`packages/talos-cli/scripts/build-server-assets.mjs`** (~50 LOC, build-time)
- `pnpm --filter talos-app build:web`
- Copy webapp dist, pglite wasm, server migrations → `packages/talos-cli/server-assets/`

**`packages/talos-server/sources/index.ts`** (NEW, ~40 LOC)
Export from refactored `standalone.ts`:
```ts
export async function migrate(opts: { pgliteDir: string; migrationsDir: string }): Promise<void>
export async function startServer(opts: {
  port: number; host: string; pgliteDir: string; masterSecret: string;
  staticDir?: string; injectHtmlConfig?: Record<string, unknown>;
}): Promise<{ close(): Promise<void>; url: string }>
```
When `staticDir` set, register `@fastify/static` on `/*` with an `onSend` hook that prepends the `__TALOS_CONFIG__` script tag into `index.html`.

### Modified files

**`packages/talos-cli/package.json`**
- Dep: `"talos-server": "workspace:*"` (only — fastify-static and pglite come transitively)
- `files`: add `"server-assets"`
- `build`: run `build-server-assets.mjs` before `pkgroll`

**`packages/talos-cli/src/index.ts`**
- One new subcommand branch for `server` (~10 LOC)

**`packages/talos-cli/src/persistence.ts`**
- Add `serverUrl?: string` to `Settings` (~2 LOC)

**`packages/talos-cli/src/configuration.ts`**
- Add `settings.serverUrl` to URL precedence (~3 LOC, but needs sync settings read at bootstrap)

**`packages/talos-server/package.json`**
- Flip `"private": false`
- Rename to `"talos-server"`
- Add `"main": "./sources/index.ts"` + `exports` map
- Add `@fastify/static` dep

**`packages/talos-app/sources/sync/serverConfig.ts`**
- 3-line `__TALOS_CONFIG__` fallback

**`packages/talos-app/sources/track/tracking.ts`**
- 3-layer kill switch (env var + `__TALOS_CONFIG__.disableAnalytics`) (~8 LOC)

## Net LOC

| File | LOC |
|---|---|
| `commands/server.ts` | ~80 |
| `persistence.ts` (settings field) | ~2 |
| `configuration.ts` (URL precedence) | ~3 |
| `talos-server/index.ts` exports | ~40 |
| Build script | ~50 |
| `serverConfig.ts` webapp fallback | 3 |
| `tracking.ts` analytics kill switch | ~8 |
| `index.ts` router | ~10 |
| **Total new code** | **~196** |

No daemon changes. Bundle adds ~30 MB to the npm tarball.

## Master secret

- Generated on first `talos server` start: 32 random bytes → `~/.talos/server/master-secret` (0600 perms).
- Reused on subsequent starts.
- If deleted, all self-host data becomes unreadable. Print loud warning in `talos server --reset` and in startup logs.
- No derivation from existing talos credentials — keep self-host data independent.

## Data directory layout (per-user)

```
~/.talos/
├── settings.json            existing — now also holds serverUrl?
├── access.key               existing
├── daemon.state.json        existing
├── logs/                    existing
└── server/                  NEW — only created by `talos server`
    ├── master-secret        32 random bytes, 0600
    └── db/                  PGlite data directory
        └── ...
```

## Open questions

1. **Bind host default** — `127.0.0.1` (single-user desktop, mobile can't connect) or `0.0.0.0` (mobile works on LAN, exposes port). Default `127.0.0.1`; flag `--host 0.0.0.0` documented; print warning on non-loopback binding.
2. **Prisma engines** — verify `pglite-prisma-adapter` actually sidesteps native query engines after pkgroll bundling. If not, per-platform optional deps.
3. **Sharp dep in talos-server** — ~20 MB native binary per platform. Either npm optional-deps (sharp does this itself) or stub out image processing for the self-host minimum.
4. **OAuth redirects in `connectRoutes.ts`** — hardcoded `https://<configured Talos web host>`. For self-host either env-var (`PUBLIC_WEBAPP_URL`) or disable the GitHub-connect route entirely.
5. **Multi-user vs single-user** — server is multi-tenant. Self-host probably wants "first client auto-pairs, rest rejected". Out of v1 scope.

## Suggested implementation order

1. **Analytics kill switch first** — patch `tracking.ts` with the 3-layer guard. Tiny PR, lands immediately, useful even without self-host.
2. Export `migrate` / `startServer` from `talos-server`, flip `private: false`, add `@fastify/static`. No functional change anywhere else. Verify package publishes cleanly.
3. Add `window.__TALOS_CONFIG__` fallback to `serverConfig.ts`. No behavior change in production.
4. Build-assets script + `server-assets/` directory. Verify `pkgroll` includes it.
5. `settings.serverUrl` field + `configuration.ts` precedence change. Test that existing users see no change (undefined → fallthrough).
6. `talos server` command end-to-end. Smoke test: `talos server` in one terminal, `talos claude` in another, verify CLI targets localhost.
7. Docs / README.
8. Release.

## v2 ideas (not now)

- Daemon-managed server lifecycle (`talos daemon start --server`, auto-restart, launchd integration).
- Process isolation so a server crash doesn't take the daemon down.
- Admin-token / auto-pair-first-client for single-user enforcement.
- `talos server status` / `talos server stop` as ergonomics on top of the foreground command.
- Build-time stub swap to fully remove `posthog-react-native` from the bundle (Metro resolver alias `tracking.ts` → empty module).
- Parameterize the 5 cosmetic `<configured Talos website>` URLs.
- `PUBLIC_WEBAPP_URL` for talos-server OAuth redirects.

## Orthogonal cleanups worth doing

- **113 MB `difft` binary** in the published tarball — almost certainly a multi-platform blob. Split into per-platform optional deps → ~70 MB saved per install, more than offsets the new self-host assets.
- The 5 hardcoded `<configured Talos website>` URLs in CLI / settings / system prompt.

## Audit reference (state of the repo when this plan was written)

### Analytics
Only `talos-app` has PostHog (`packages/talos-app/sources/track/tracking.ts:4`), already gated by `config.postHogKey`. CLI / agent / server have zero analytics (grepped).

### Server URL configurability (already exists)
- CLI / agent: `TALOS_SERVER_URL` env var (default `https://api.cluster-fluster.com`).
- Web app: in-app Settings → Server screen + `EXPO_PUBLIC_TALOS_SERVER_URL`.
- Server: `pnpm standalone:dev` runs with PGlite — no Docker, no Redis. Entry: `packages/talos-server/sources/standalone.ts`.

### Hardcoded `<configured Talos website>` URLs (cosmetic)
- `talos-app/sources/components/SettingsView.tsx:396` — privacy link
- `talos-cli/src/ui/doctor.ts:225`, `src/claude/utils/systemPrompt.ts:20-23`, `src/commands/connect.ts:74` — docs / attribution
- `talos-server/sources/app/api/routes/connectRoutes.ts` — GitHub OAuth redirect
- `talos-app/app.config.js:46,77` + iOS/Android manifests — universal link domain

### Published package size
`talos@1.1.7` on npm: **121 MB packed / 238 MB unpacked**. Dominated by `tools/unpacked/difft` (113 MB) + ripgrep platform archives (~27 MB).
