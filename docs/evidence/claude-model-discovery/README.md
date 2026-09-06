# Claude model discovery validation

This is preserved historical evidence from before the Talos rebrand. Its screenshots,
package names and commands describe that original validation run; current product
and deployment instructions are in the Talos release documentation.

Validated on 2026-09-06 from `feat/claude-model-discovery`, based on main `95636e57`.
The browser ran the changed Happy app at `http://localhost:63838` against a real
isolated Happy server at `http://localhost:63837`, with a daemon built from this
worktree and the installed Claude Agent SDK 0.3.220. No model RPCs or catalogs were
mocked in this browser run. The test account and Happy data were isolated from
production; Claude used the machine's existing provider configuration.

## Automated validation

```sh
pnpm --filter @slopus/happy-wire build
pnpm --filter happy-improved build
pnpm --filter happy-improved exec vitest run --project unit
pnpm --filter happy-app exec vitest run --maxWorkers=4
pnpm --filter happy-app typecheck
cd packages/happy-app
APP_ENV=production pnpm exec expo export --platform ios --output-dir dist-ci
```

Results: CLI build/typecheck passed; 82 CLI test files / 752 tests passed;
62 app test files / 723 tests passed; app typecheck passed; production iOS Hermes
bundle exported successfully. `git diff --check` passed. This is export validation,
not evidence of OTA receipt or TestFlight delivery.

## Real browser flow

The repository environment helper started the actual server, seeded a local
account, and started a worktree-built daemon. `agent-browser` opened the helper's
local authenticated URL. Authentication material is intentionally omitted here.

1. Open `/new`, select Claude, and open Model. The machine RPC returned Default
   (recommended), Opus (1M context), Fable, Sonnet and Haiku with provider descriptions.
   [New-session catalog](new-session-models.png).
2. Select Haiku. Its advertised effort list is empty and the effort picker hides.
   [Haiku selected](haiku-no-effort.png).
3. Create a session through the browser and open its settings control. The same
   provider catalog and per-model efforts appear. An additional empty session was
   used for the screenshot. [Existing-session catalog](existing-session-models.png).
4. Open `/settings/agents` and expand Claude's Model field. The catalog is discovered
   from the online test machine; the code default is now the provider default.
   [Agent defaults](settings-models.png).
5. Stop the isolated daemon while `/new` is open. Happy falls back to its offline
   catalog and disables starting sessions. Restart the daemon and observe the live
   catalog return. [Offline fallback](offline-fallback.png),
   [recovered live catalog](recovered-live-models.png).

Representative real daemon log (machine ID omitted):

```text
[13:16:14.160] [RPC] Handler returned { method: '<machine>:claude-list-models', hasResult: true }
[13:16:14.161] [RPC] Sending encrypted response { method: '<machine>:claude-list-models', responseLength: 2088 }
[13:16:16.741] [RPC] Handler returned { method: '<machine>:claude-list-models', hasResult: true }
```

## Generation check limitation

An additional prompt requested `CLAUDE_DISCOVERY_OK` without tool use. The real
session received `model: "haiku"` and `effort: null`; Claude initialized with
`model: "claude-haiku-4-5-20251001"`, confirming the discovered selector reached
the provider. Generating the reply failed with `Failed to authenticate: OAuth
session expired and could not be refreshed`. No successful model-generated reply
is claimed. Catalog discovery, picker rendering, session creation, selection
propagation, and offline recovery were exercised through real services and passed.

## Delivery

The app and target machine daemons both need this change. Older daemons retain
the compatibility fallback until updated. Merge through the PR; web/mobile ship
through their Jenkins pipelines. Mobile selection is normally OTA for these app
source changes, subject to the pipeline's delivered baseline and runtime check.
