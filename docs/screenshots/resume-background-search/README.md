# Resume and background search validation

Validated 2026-09-12 using a real Chrome browser at a 390 × 844 phone viewport, the actual `https://api.happy.ahposten.com` API, a dedicated authenticated synthetic account, an isolated real Talos daemon, and a real Codex provider thread. No user sessions were resumed, stopped or modified.

## Observed UI and service behavior

1. Restored the synthetic account and left the search input untouched. IndexedDB already contained 11 encrypted cache records, covering five sessions, before opening search. [Search closed](indexed-with-search-closed.png)
2. Searched `amber sailboat` and opened a synthetic archived session. The app displayed **Resume Session** with the experiment disabled. [Resume action](resume-action.png)
3. Tapped Resume. This archive intentionally predated the isolated daemon's checkpoints. Its encrypted RPC error exposed the previously ignored error-envelope issue; after normalization, the app used the daemon's provider-resume spawn path.
4. The new Talos session resumed the same Codex thread, restored its earlier user/agent messages, and became online. Asking the agent to recall the prior passphrase returned `amber sailboat`. [Live resumed conversation](resumed-conversation.png)
5. While the conversation screen stayed open, the encrypted search cache grew to 15 records, including the new conversation and messages. No search screen was required to continue indexing.
6. Stopped the isolated daemon, deleted all six allowlisted synthetic sessions and its synthetic machine, and verified no sessions remained. [Cleanup](cleanup.json)

Checkpoint-backed sessions use the existing same-ID resume RPC. Older Claude/Codex archives without recovery data continue the same provider conversation in a new Talos session linked to the original. The fallback is limited to the daemon's explicit pre-launch “recovery data unavailable” result; transport errors, timeouts, deleted sessions and wrong-machine errors do not spawn another agent. A reachable original machine and its local provider history are required.

## Commands and checks

```sh
pnpm install --frozen-lockfile
pnpm --filter talos-app exec vitest run --maxWorkers=4
pnpm --filter talos-app typecheck
pnpm verify:brand
# From packages/talos-app:
APP_ENV=production pnpm exec expo config --type introspect --json
APP_ENV=production pnpm exec expo export --platform ios --output-dir dist-ci --max-workers 4
```

- App suite: **856 tests passed in 82 files**.
- TypeScript and whitespace checks passed.
- Production iOS bundle export passed.
- Expo native configuration introspection confirmed `processing` in `UIBackgroundModes` and `com.expo.modules.backgroundtask.processing` in `BGTaskSchedulerPermittedIdentifiers`.
- Background-task tests cover account startup without search, foreground/background transitions, cold-process encryption restoration, unavailable credentials, bounded execution, returning to foreground during a run, logout races, and retryable failures. The real coordinator test verifies a one-shot run leaves no polling timer.
- The existing keychain item is retained, with `AFTER_FIRST_UNLOCK` accessibility for scheduled locked-device reads. The regression test verifies the same key and no service/access-group change. Search cache contents remain encrypted and account/server scoped.

Browser automation used `agent-browser --session resume-background --state <private-synthetic-state> open http://localhost:8090`, then `snapshot`, `fill`, `click`, `screenshot` and a read-only IndexedDB record count. The source ran via `APP_ENV=development EXPO_PUBLIC_TALOS_SERVER_URL=https://api.happy.ahposten.com CI=1 pnpm exec expo start --web --port 8090`. The daemon used a dedicated `TALOS_HOME_DIR` containing only synthetic account credentials. The provider thread was seeded through the real Codex app-server before the archived Talos record was created.

## Physical-device validation limitation

The user explicitly said: “It isnt available right now / Do without that validation.” Scheduled execution while a physical iPhone is minimized/locked was therefore **not exercised**. Browser E2E, task logic, native configuration and bundle export were validated; none is represented as physical iOS scheduler evidence. Expo documents that its background-task scheduler requires a physical iOS device. iOS decides when to run scheduled work and stops it after the user force-quits the app; this feature does not promise continuous execution while locked.

Background scheduling introduces native modules, so this release requires a new production/TestFlight binary rather than an OTA for build 23.
