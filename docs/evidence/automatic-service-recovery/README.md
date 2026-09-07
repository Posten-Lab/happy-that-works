# Automatic service and session recovery: browser evidence

Captured on September 7, 2026 in the isolated `vivid-pearl` environment. The Expo
web app connected to a real local Talos standalone server with PGlite and a real
launchd-managed daemon. Claude and Codex used their actual authenticated CLIs.
Screenshots contain no authenticated URLs, tokens, or encryption keys.

| Screenshot | Observed result |
| --- | --- |
| [Automatic restore setting](automatic-restore-setting.png) | Switched recovery off and on through the UI; the daemon persisted `enabled: true`. |
| [Codex context after automatic recovery](codex-context-after-recovery.png) | After its process and daemon were interrupted, the same conversation recalled `RECOVERY_BEFORE` and replied `RECOVERY_BEFORE RECOVERY_AFTER`. |
| [Machine recovery failure](machine-recovery-failed.png) | A temporarily missing project directory exhausted retries and produced a visible error linked to the affected session. |
| [Retry from the failed session](session-recovery-retry.png) | The failure and Resume action appeared with default settings. Recovery state overrode stale online presence. |
| [Claude context after manual recovery](claude-context-after-manual-recovery.png) | After the directory was restored, Resume reconnected the same conversation; Claude recalled `RECOVERY_CLAUDE_BEFORE` and replied `RECOVERY_CLAUDE_BEFORE CLAUDE_RECOVERED`. |

The [manifest](manifest.json) records original capture filenames, UTC times,
dimensions, image hashes, and the implementation revision status. These are
original browser captures, without mocked services or responses. A separate
390×844 viewport check confirmed the recovery controls and result links fit on a
phone screen.

Browser actions used `npx --yes agent-browser --session talos-recovery-ui` with
`open`, `snapshot -i`, `click`, `fill`, `press Enter`, and `screenshot`. Authentication
was loaded privately from the isolated environment configuration. The browser
session was closed after validation.

Additional actual-service checks:

- With the isolated daemon paused and its real Codex process unavailable,
  Archive Session persisted encrypted `lifecycleState: archived`, deactivated the
  server session, and preserved the provider thread. Post-restart archive checks
  are recorded with the service validation.
- A separate conversation containing metadata unknown to the app retained that
  metadata after the UI force-archive flow.
- `GET /v1/sessions/:sessionId` returned 200 to its owner, 401 without
  authentication, and 404 to a separately authenticated account.

Checks run:

```text
pnpm --filter talos-app typecheck                                  passed
pnpm --filter talos-app exec vitest run                            74 files, 776 tests passed
pnpm --filter @ahmadposten/talos-server typecheck                   passed
pnpm --filter @ahmadposten/talos-server test                        17 files, 104 tests passed
```

The Mac was not rebooted or logged out during these browser checks. Process
interruption and service supervision were exercised in isolation; Linux service
and restart evidence is recorded separately with the service validation.
