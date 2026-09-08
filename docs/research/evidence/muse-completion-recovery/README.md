# Muse completion recovery

A fresh Muse session finished natively while its Talos runner remained busy and
queued later user messages. Native durable history contained the complete reply
and terminal event; Talos had stopped receiving the live stream earlier. The
existing recovery timer was enabled only after resume or terminal handoff.

Recovery now runs for every prompt. Each observer pages from its own history
origin and follows only its own continuation cursors. A live writer cursor is
not portable to the folded observer projection: a real follow-up test reproduced
a cursor being accepted while skipping the reply and returning only completion.
Observers are bound to the original turn and host, so a late response cannot
finish or modify a later turn. Synthetic `failed/incomplete` folds remain
nonterminal, and message IDs suppress replay duplicates. Only the latest saved
todo state is replayed when scanning history.

## Validation (2026-09-08, macOS arm64)

- Before the fix, the new fresh-session regression timed out; its resumed-session
  equivalent passed.
- `pnpm --filter talosapp test`: build, typecheck, and all **1,010 tests in 113
  files passed**. Coverage includes missing notifications, incomplete live folds,
  nonportable writer cursors, a follow-up after recovery, and a stale observer
  arriving during the next turn.
- `pnpm --filter talosapp exec tsx tests/muse-e2e/completion-recovery-probe.ts`:
  **passed** against authenticated Muse 1.0.3-R2198.1 / Spark 1.3 Contributor.
  The executable proxy launches real Muse and deliberately drops all live
  `item/*` and `turn/completed` notifications. It passes protocol requests and
  their responses unchanged; inference and durable history are real.
- The fresh turn returned `amber-572-heron`; a follow-up chained behind it
  returned `violet-639-otter`. Both replies arrived exactly once and both prompts
  settled on the same native session. Final run dropped **11 notifications**,
  including both completion events, and ended with activity false.

The live affected chat was separately recovered by gracefully replacing only its
verified idle runner. The same Talos/native identities were retained, and the
previously missing 4,452-character answer appeared in the encrypted Talos message
history. Other sessions were left running.

No package release is included in this PR. Newly started sessions need a CLI
release containing this fix; recovery of the reported chat used the existing
resume path in CLI 1.0.8.
