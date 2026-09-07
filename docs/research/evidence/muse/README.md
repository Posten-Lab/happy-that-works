# Muse provider validation — 2026-09-07

Environment: macOS arm64, Node 25.1.0, pnpm 10.30.1, official Muse CLI
1.0.3-R2198.1 and SDK 0.1.1. Talos ran in an isolated authenticated local
server/app/daemon environment. IPv6 localhost was used because local IPv4
connections timed out; the user's production Talos installation was not replaced.

## Current status

Billing now works. The first real model response succeeds, and the live
approval-denial/interruption test passes. The model-change/resume acceptance test
still fails, now with a native Muse history replay error rather than HTTP 402.
This error was independently reproduced using only the official SDK and `muse
serve`, without importing Talos adapters or transport. PR #25 remains a draft.

## Passed

- CLI build/typecheck and all 859 unit tests (97 files).
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

## Earlier billing blocker — resolved on the latest retry

The real `answers multiple turns, changes model and resumes durable history`
acceptance test failed after Muse's 10 retries (about 258 seconds):

> API error 402: Billing verification failed. Please check your payment method.

Request ID: `46ca93f5-8703-49e9-b299-822f6f019aa7`.
The separate tool approval test was not run during that earlier attempt.
The latest retry below confirms billing access now works, but a different native
resume failure still prevents merging.

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

## Retry after reported billing fix — 2026-09-07

Re-ran `pnpm --filter talosapp exec vitest run --project integration-muse -t
'answers multiple turns'` with the existing authenticated CLI. The first model
response again failed after all 10 provider attempts (256.74 seconds): HTTP 402
`Billing verification failed. Please check your payment method.`

Meta request ID: `d9d9aa3e-edd7-4472-88f1-eaa2a314bfc9`.
Outer request ID: `3ff30f3c-03e2-4793-9af4-bd39dbe650fc`.
The remaining two acceptance cases were not selected in this retry. No application
code changed. PR #25 remains a draft; its existing CI checks are green, including
packaged CLI checks on Linux and Windows with Node 20 and 24.

## Latest retry — billing resolved; native resume failure

`answers multiple turns, changes model and resumes durable history` now gets the
expected `copper-otter` first response. After closing and resuming its native host,
the next turn fails with:

> provider-private history is incompatible with the active route

Muse reports missing provider attribution on a reasoning replay item after a
provider switch. The independent native reproduction starts a default session,
selects `muse-spark-1.3` with explicit `providerId: meta`, completes one turn,
restarts/resumes, reapplies the same selection, and fails on the second turn.

Run from `packages/talos-cli`:

```sh
node tests/muse-e2e/native-model-resume-repro.mjs
```

A separate native probe starting directly with `muse-spark-1.3` succeeded across
resume when the same selection was reapplied. It also exposed a case where the
resume response reported the startup Contributor model instead of the original
model. The adapter now reads the stored model before resume, restores its
advertised routing if substituted, and refuses an unavailable saved model rather
than silently accepting another one. Model selection also retains the advertised
provider/profile. These guards do **not** solve the native history replay error.

Additional live result: `routes real approvals, interrupts work, and rejects
unsupported permission modes` passed (8.50s). It observed and denied a real shell
approval, verified no file was written, then interrupted another admitted turn.
The exact model-backed resume failure remains an acceptance gate; no history is
discarded or rewritten to hide it.
