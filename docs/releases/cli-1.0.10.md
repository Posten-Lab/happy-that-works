# Talos CLI 1.0.10

**Superseded by 1.0.11.** Fresh registry installation exposed missing workflow
exports in published wire 0.1.1. The local package checks used a newer wire build
under the same version and did not detect the mismatch. Version 1.0.10 was
deprecated and `latest` was restored to 1.0.9 before either machine was activated.
The corrected release publishes wire 0.1.2 first and verifies its actual registry
artifact with the CLI before publishing CLI 1.0.11.

This patch fixes Codex completion notifications. Long-running turns no longer
time out after ten minutes and send a premature completion notification.
Notifications now follow successful terminal completion, after queued work has
finished. Cancellation, errors, thread-idle updates, and duplicate completion
events do not produce a false success notification.

The implementation was merged in [PR #41](https://github.com/Posten-Lab/happy-that-works/pull/41).
Its [real Codex evidence](../research/evidence/codex-completion-push/README.md)
includes a turn lasting more than ten minutes, cancellation, and a subsequent
successful turn. Release checks and registry/install results are recorded in the
release PR.

Release validation passed on macOS arm64: the complete CLI prepublish chain
(1,040 tests in 117 files), 29 wire tests, brand verification, and all packaged
installation scenarios. The latter exercised real relay startup, database-backed
authentication, and the bundled web app with isolated, hoisted, and cached
dependencies. [Release-build Codex controls](./cli-1.0.10-controls.json) confirmed
zero completion notifications for cancellation and exactly one for a successful
follow-up.

Publish with `pnpm release cli --publish`, using the canonical private npm
credential selected by the release wrapper.

Install `talosapp@1.0.10` for new sessions. Existing session processes keep their
loaded version; resume them after their current turn ends to use the update.
