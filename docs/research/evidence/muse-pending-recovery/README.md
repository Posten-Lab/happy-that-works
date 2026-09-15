# Muse pending-request recovery (2026-09-15)

On the operator Mac, Talos 1.0.19 with Muse 1.3.0-R3057.1 posted 140 copies of:

```
Muse event recovery failed: MspError: internal error: loaded pending projection unavailable: materialized session view is unavailable
```

The native turn continued to execute tools and completed after 427696 ms. During the failure, a separate Muse observer successfully read `session/read`, `view/page`, and `approval/listPending` for the same native session. Its read-only fold reported the live turn as `incomplete` until the actual completion was durable. The user's session identifiers and transcript are deliberately excluded from this evidence.

Recovery paged events through an observer but queried `approval/listPending` on the writer. The fix keeps both reads on the observer. Approval decisions still go to the writer with their existing requirement guards. Recovery failures now produce one notice per outage; retries continue, and a successful read resets warning suppression.

## Validation

- `pnpm --dir packages/talos-cli exec vitest run --project unit`: all 1102 tests passed across 121 files.

- `pnpm --dir packages/talos-cli build`: passed, including TypeScript checking.
- `pnpm --dir packages/talos-cli exec vitest run --project unit src/muse/MuseSession.test.ts src/muse/museProtocol.test.ts src/muse/museControls.test.ts`: 45 passed. Includes separate writer/observer coverage and retry/warning reset coverage.
- `pnpm --dir packages/talos-cli exec vitest run --project integration-muse src/muse/muse.integration.test.ts -t 'routes real approvals'`: passed with installed Muse and the authenticated provider. Denial, approval, file effects, cancellation, and unsupported permission modes exercised.
- `TALOS_DAEMON_CHILD=1 TALOS_E2E_CLI_ROOT="$PWD/packages/talos-cli" node docs/research/evidence/muse-pending-recovery/e2e.mjs`: passed with actual Muse and the live encrypted Talos relay. Created a chat, used its title tool, ran a long terminal turn, observed zero recovery warnings, restarted with the same native ID, and recalled the code word. The harness removes only its own test chats/workspace.

The short isolated baseline also passed on unpatched 1.0.19: the native projection failure is intermittent and was observed directly in the reported session. The unit regression deterministically models that observed writer failure; the real-service runs validate the replacement read path and its surrounding lifecycle without protocol or provider mocks.
