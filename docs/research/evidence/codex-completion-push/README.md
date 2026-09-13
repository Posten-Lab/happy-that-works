# Codex completion push timing

The interactive Codex runner stopped waiting after ten minutes, returned an
aborted result without interrupting Codex, and sent a done push from its `finally`
block. Codex continued working. Its eventual completion no longer had a waiting
caller, so that completion produced no push.

## Before

[Sanitized runtime timings](./before.json) from September 12, 2026 show three
turns that notified at 600.1 seconds but actually completed after 1,592.7 to
3,854.5 seconds. These records contain only timestamps; prompts, session IDs,
paths, and credentials are omitted.

## Change

Interactive turns now wait for completion, cancellation, or provider exit.
Explicit deadlines for bounded workflow calls remain supported; those callers
dispose the provider after their deadline. The runner still sends UI readiness
after errors, cancellation, and context reset, but only successful, queue-drained
turns send a done push.

Codex final-answer items and thread-idle notifications no longer synthesize a
successful turn completion. Idle can arrive before the terminal outcome of an
interrupted turn. Duplicate terminal events are discarded before they can resolve
a new pending turn or clear its active ID.

## Validation

- `pnpm --filter talosapp exec vitest run --project unit`: **1,040 tests passed in
  117 files**, including the CLI build and typecheck. The first full run found
  missing unpacked `rg`/`difft` tools in the fresh worktree; running
  `node packages/talos-cli/scripts/unpack-tools.cjs` fixed the setup and the full
  suite passed on rerun.
- Focused regression coverage advances both raw and legacy Codex event streams
  to 65 minutes, then verifies one completion notification. It also covers
  explicit workflow deadlines, provider exit, unsuccessful-turn readiness,
  pending messages, queued messages, and shutdown.
- Real provider/relay probe:
  `TALOS_COMPLETION_CODEX=/opt/homebrew/bin/codex TALOS_COMPLETION_EVIDENCE=/tmp/talos-completion-e2e.json pnpm --filter talosapp exec tsx tests/codex-e2e/completion-push-probe.ts`.
  The optional Codex path selects the installed CLI over a workspace copy.
  The probe uses an isolated PGlite relay, seeded account, daemon, built CLI,
  and authenticated Codex. It submits an actual 620-second shell command and
  observes activity and the real push endpoint's session-event broadcast.
  The disposable account has no phone token, so this tests notification dispatch;
  it does not test Expo/APNs delivery or tapping a notification on a handset.
- [Long-turn results](./long-turn.json): the real session remained thinking with
  zero done notifications at **605,063 ms** and received its completion push at
  **629,829 ms**. The subsequent cancellation phase exposed a second false done
  notification (included in the trace) and a probe decoder that could not handle
  the abort RPC's void return. The idle/final-answer inference and duplicate-event
  fixes above address the false completion; the probe now checks the void RPC
  acknowledgement directly. The control phase is rerun separately using
  `TALOS_COMPLETION_CONTROLS_ONLY=1` against the final build.
- [Final control results](./controls.json): **passed**. A real cancelled turn
  produced zero done notifications, and a successful follow-up on the same
  session produced exactly one. The probe exited successfully and cleaned up
  its isolated session, daemon, server, and web process.
