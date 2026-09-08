# Talos CLI 1.0.9

This patch packages the Muse completion recovery fix from PR #33. A fresh Muse
session could finish natively while Talos kept showing it as busy and queued
follow-up messages. The CLI now checks durable history for every turn, restores
missing replies, and releases the queue when completion is confirmed.

Recovery uses the reader's own pagination positions, avoiding a separate failure
where a live writer position skipped the reply. Late recovery results cannot
complete a newer turn, and incomplete live history is not treated as failure.

See the [regression and real Muse evidence](../research/evidence/muse-completion-recovery/README.md).
The real provider test deliberately dropped live reply/completion notifications
and recovered two consecutive replies exactly once on the same native session.

Install CLI 1.0.9 for new sessions. Existing processes keep their loaded version;
resume an existing Muse session after its current turn ends to use the update.
The reported stuck chat was already recovered with its saved response intact.

Release validation, registry publication, and installation results are recorded
in the release PR. Publication uses `pnpm release cli --publish` with the approved
private credential and complete publication hooks.
