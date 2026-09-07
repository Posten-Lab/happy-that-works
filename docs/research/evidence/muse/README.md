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

## Unchanged-model verification — 2026-09-07

With Muse 1.0.3 and SDK 0.1.1, real authenticated inference confirmed:

- Native default session: first response plus two host restart/resume cycles
  retained `copper-otter`; stored and resumed model stayed
  `muse-spark-1.3-contributor` (provider `meta`).
- Native explicitly initialized Contributor session: the same three turns and
  two restart/resume cycles passed with unchanged routing.
- Native explicitly initialized `muse-spark-1.3`: all three answers passed,
  **but stored and resumed routing reported Contributor**. This is not evidence
  of preserving the non-default model. No probe called `session/setModel`.
- Talos MuseSession adapter, no model option: three turns across two fresh host
  restarts retained both session identity and the code word. A second run passed
  those checks and then switched the populated session into the actual native
  terminal in a PTY, displayed the restored conversation and Contributor model,
  switched back into Talos, and answered the context question successfully.
  Handoff session: `01a07c41-b250-7502-be0a-2efe61399481`.

Reproduce from `packages/talos-cli`:

```sh
node tests/muse-e2e/native-unchanged-model-probe.mjs
pnpm exec tsx tests/muse-e2e/unchanged-model-probe.ts
# Requires a real terminal; exposes native Muse for eight seconds.
MUSE_TEST_HANDOFF=1 pnpm exec tsx tests/muse-e2e/unchanged-model-probe.ts
```

These probes establish a viable default-model-only path, not universal resume
reliability. The terminal probe restores populated history but does not submit a
new prompt from the native terminal. No application restriction is implemented
by this verification change. A temporary restriction would need to reject model
changes in the adapter as well as disable the picker, and account for changes
made outside Talos in the native CLI. Existing sessions with model-switch history
are not repaired by locking their model now. Non-default initial selection needs
further routing verification before it can be included in the supported path.


## Fixed-model supported path — 2026-09-07

The temporary restriction is now implemented. Talos exposes only Muse Spark 1.3
Contributor, rejects model/provider/profile CLI overrides and other requested
models, verifies native routing before each prompt, and checks durable model
change events before resume. A real test changed models through the native SDK
and changed back; Talos rejected that history before acquiring the resume lease.
No model is automatically substituted and no history is rewritten.

Live verification after the restriction:

- All three real provider acceptance cases passed (70.70 seconds): multi-turn
  inference, rejected model selection, durable resume, approval denial, and
  interruption/release. The extended external-change rejection case also passed
  (66.09 seconds).
- The populated PTY terminal handoff passed again with the restricted adapter:
  native session `01a07c48-e924-7ec0-9a7b-e1b2d9c06e56` retained context after two
  restart cycles and Talos → native terminal → Talos.
- Real browser: created a Muse session in isolated environment `tidy-beacon`,
  received `silver-badger`, answered a native choice question, approved its shell
  request, and verified `muse-approved.txt` contained exactly `silver-badger`.
- Stopped that provider process, enabled the existing Resume Session feature in
  the test account, and clicked Resume Session. The same Talos session
  `cmtrccoqr0001ripw92yb1cue` resumed native session
  `01a07c4a-3250-79f2-8849-d31fa5f8c124`; the next response remembered the code word.
  Enabling the test setting required invoking the checkbox change handler because
  browser automation clicks did not toggle it. The resume button itself was
  exercised with a real click.
- Browser verification found generic tool labels and an approval timer that stayed
  running after resolution. Tool mapping now reads the native `tool` field and
  emits completion for the approval stage separately from the actual shell result.
  The corresponding 17 adapter/protocol unit tests pass.
- Full CLI unit suite: 861 tests / 97 files passed before the display fix; the
  changed adapter/protocol tests passed afterward. App typecheck and 13 model
  option tests passed. Branding verification passed.

Screenshots: [restricted selection](model-restricted.png),
[native question](native-question.png), [shell approval](shell-approval.png),
[approved edit](approved-edit.png), [resumed context](resumed-context.png).
These capture the real app with the real local server and authenticated provider.
The question/edit captures preceding the display fix preserve that test's original
UI evidence. The question-answer reload issue found in this run is fixed for newly answered
questions by persisting their answer map in the tool result.

The expanded approval acceptance test passed (179.10 seconds), including a denied
write, a successfully approved write with exact content, and interruption. Browser
recovery subsequently exposed a shared API lifecycle bug: `close()` emitted a
socket disconnect that scheduled a reconnect, leaving the old provider competing
for permission RPCs. `ApiSessionClient.close()` now latches closed state, cancels
both reconnect timers, and refuses late reconnects. A regression test includes
both a pending reconnect and disconnect/error events during shutdown. The final
CLI unit suite passes 862 tests across 97 files.

Live shutdown verification after the fix: stopping resumed PID 12237 with SIGTERM
made the browser session inactive and exposed Resume Session. The process then
exited and stayed absent, instead of reconnecting. A preceding test with the old
build required terminating stale processes and sending session-end for their
abandoned test presence; that cleanup is not counted as automatic crash recovery.
The raw `talos resume` command also reported missing imported session keys in this
seeded account; the app/daemon resume path was the path validated here.

Stale Muse model preferences in existing session settings and saved message
snapshots are now ignored by the updated app, preventing an invisible old model
choice from trapping the fixed-model UI. Native routing checks remain authoritative.

A fresh browser test also caught `request_user_input` being labeled as a generic
tool, which could show approval buttons in place of the answer form. Native
question tools now map to the existing AskUserQuestion component, and native
persisted answer results are normalized to the same answer map as live replies.
The updated 18 adapter/protocol tests pass. A second real provider process (13623)
also exited normally after SIGTERM with the shared shutdown fix.
