# Talos CLI 1.0.11 and wire 0.1.2

This release includes the Codex completion-notification fix from PR #41 and
publishes the workflow schemas required by the current CLI as wire 0.1.2.
CLI 1.0.11 resolves its workspace dependency to this new immutable wire version.

The preceding 1.0.10 release failed on a fresh registry install because published
wire 0.1.1 lacked workflow exports already present in the repository. Local and
CI packaging checks used a local wire override, masking that difference. No
active machine was switched to the broken release; it was deprecated and the
previous `latest` tag was restored.

`pnpm verify:packaged --cli-only --registry-wire` now installs the candidate CLI
tarball with its real published wire dependency. Run this after publishing wire
and before publishing CLI to catch missing registry exports or dependency versions.
The usual local package matrix remains available before publication.

Publish in order with `pnpm release wire --publish`, verify the registry-wire
installation, then `pnpm release cli --publish`. Record validation, registry
integrity, and machine installation results in the release PR.

Install `talosapp@1.0.11` for new sessions. Existing processes retain their loaded
version; resume them after their current turn ends to use the update.
