# Resume after a machine registration changes

Validated 2026-09-12 using Chrome at a 390 × 844 phone viewport, the real legacy API (`https://api.happy.ahposten.com`), a dedicated synthetic account, an isolated installed Talos 1.0.9 daemon, and an actual Codex provider thread. No user conversation was resumed or modified.

1. Created an offline machine record and an online daemon registration with matching host, OS user directory, platform, and architecture. Created an archived conversation referencing only the offline record, with a different session-level host name and no daemon checkpoint.
2. Opened the archive in the app with experimental resume disabled. **Resume Session** was available: [screenshot](resume-available.png).
3. Tapped Resume once. The app routed the recovery request and the explicit missing-checkpoint fallback to the live registration. Exactly one continuation appeared; it retained the provider thread ID and linked to the original archive.
4. Asked the resumed agent for information from the earlier provider conversation. It replied with the saved passphrase, **amber sailboat**: [screenshot](resumed-history.png).
5. Verified the original registration remained offline, the replacement was online, and the continuation ran on the replacement with the same provider thread: [service assertions](verification.json).
6. Stopped the isolated session and daemon, deleted all six synthetic sessions and both synthetic machine records, and verified no sessions remained: [cleanup](cleanup.json).

## Checks

- `pnpm install --frozen-lockfile`
- `pnpm --filter talos-app exec vitest run --maxWorkers=4`: **867 passed, 83 files**.
- `pnpm --filter talos-app typecheck`: passed.
- `pnpm verify:brand`: passed.
- `APP_ENV=production pnpm exec expo export --platform ios --output-dir dist-ci --max-workers 4`: passed.
- `git diff --check`: passed.

Regression cases cover preferring the live original, matching a replacement despite a Tailscale session hostname, rejecting a different host/user/platform/architecture, rejecting ambiguous or offline replacements, rechecking availability before launch, and routing both RPC paths to the resolved registration. Existing failure tests ensure transport errors and timeouts never trigger a second launch.

## Scope

A replacement is selected from the authenticated account's decrypted machine metadata only when the original is offline and exactly one online registration matches host, OS user directory, and platform (and architecture when both supply it). These fields identify the existing machine environment; they are not hardware attestation. Missing or ambiguous metadata does not select another machine. A powered-off computer with no reachable daemon cannot be restored by this change.

Older archives without recovery checkpoints continue the same provider conversation in a linked Talos session, using the existing fallback. No native modules or daemon changes are introduced. The physical-iPhone background scheduler test remains waived by the user's earlier instruction; this change was exercised through the actual browser UI and services.
