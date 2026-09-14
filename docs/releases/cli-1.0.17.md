# Workflow recovery and CLI 1.0.17

PR #59 preserves provider failure messages, shows the full workflow sequence, and lets an interrupted builder resume with another model without discarding approved planning. Wire 0.1.6 supplies the recovery action and historical model snapshots; CLI 1.0.17 implements the versioned recovery RPC. The web and mobile clients include the recovery controls and in-app release notes.

Preparation passed on the combined workflow-recovery and current-main candidate:

- `pnpm install --frozen-lockfile --offline`.
- Wire `prepublishOnly`: 34 tests.
- CLI `prepublishOnly`: 1,093 tests.
- App `vitest run --maxWorkers=4`: 987 tests; app typecheck passed.
- `pnpm verify:brand`.
- `pnpm verify:packaged --cli-only`: real isolated and hoisted installs, embedded version 1.0.17, diagnostics, native tools, and launcher searches.
- Real Chrome at 390 × 844 displayed the generated [release notes](../evidence/workflow-recovery/release-changelog-mobile.png) from the release candidate.

The affected workflow's real provider, daemon-restart, browser, file-write, and independent-review validation is recorded in [the workflow recovery evidence](../evidence/workflow-recovery/README.md). Recovery preserved all planning task IDs and the approved plan version. The original user's interrupted workflow was also resumed through the versioned RPC using Sol and retained its approved planning.

Publish wire first through `pnpm release wire --publish`, then run `pnpm verify:packaged --cli-only --registry-wire` against the actual published dependency before `pnpm release cli --publish`. Verify registry artifacts through an isolated installation. Deploy the reviewed main revision through the guarded Jenkins web and mobile jobs. Preserve the existing machine daemon while it is executing the user's restored workflow.

Final package and deployment receipts belong in the release PR. This release does not change databases, encryption secrets, DNS, or store identity.
