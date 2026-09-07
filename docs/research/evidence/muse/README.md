# Muse provider validation — 2026-09-07

Environment: macOS arm64, Node 25.1.0, pnpm 10.30.1, official Muse CLI
1.0.3-R2198.1 and SDK 0.1.1. Talos ran in an isolated authenticated local
server/app/daemon environment. IPv6 localhost was used because local IPv4
connections timed out; the user's production Talos installation was not replaced.

## Passed

- CLI build/typecheck and all 856 unit tests (97 files).
- App typecheck and 13 selected provider-default/model-discovery tests (4 files).
- Talos identity verification: 7 workspaces and 29 assets.
- Official Muse login completed and live native model discovery returned four models.
- Real browser: chose Muse Code, loaded its native model catalog and permission
  modes, created a Muse session through the daemon, sent a prompt, and saw the
  actual Meta billing error returned through Talos.
- Direct PTY: MSP-created session `01a07b31-20ef-76c3-a211-add44a38861a`
  resumed in the actual Muse terminal, then returned to an MSP owner with the
  same ID. The fixture exited 0 with `TALOS_SAME_SESSION_HANDOFF_PASSED`.
  This was an idle session; populated-history handoff is still unverified.
- Real CLI acceptance: `cancels a live admitted turn and releases its durable
  session` passed. It started a live turn, cancelled it, closed the owner,
  resumed the same ID and verified an invalid model is rejected.

## Blocked / not passed

The real `answers multiple turns, changes model and resumes durable history`
acceptance test failed after Muse's 10 retries (about 258 seconds):

> API error 402: Billing verification failed. Please check your payment method.

Request ID: `46ca93f5-8703-49e9-b299-822f6f019aa7`.
The separate tool approval test was not run after the account-level failure.
Login success does not establish model access. This draft is not ready to merge.

The experimental terminal automation harness made native Muse exit early and was
not retained. Its attempts are not counted as passing E2E evidence. The direct
PTY fixture is retained for reproduction.

## Screenshots

- [Provider and live model picker](model-picker.png)
- [Real session and Meta billing error](session-billing-error.png)

## Reproduce

From the repository root:

```sh
pnpm --filter talosapp exec vitest run --project unit
pnpm --filter talos-app typecheck
pnpm --filter talosapp exec vitest run --project integration-muse
```

The integration suite requires the official `muse` CLI, `muse login`, and working
Meta billing. It does not mock the host or inference service.

For the native handoff smoke check, from `packages/talos-cli` in a real terminal:

```sh
MUSE_TEST_SIGNAL=/tmp/talos-muse-handoff pnpm exec tsx tests/muse-e2e/handoff-fixture.ts
```

Once Muse has rendered its resumed session, create `/tmp/talos-muse-handoff` from
another terminal. The fixture switches back to remote ownership and verifies the
unchanged session ID. It has a 90-second cleanup deadline.
