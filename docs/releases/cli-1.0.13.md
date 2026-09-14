# Talos CLI 1.0.13 and wire 0.1.4

This release publishes the multi-provider workflow implementation merged in PR #51.
Wire 0.1.4 contains the provider schemas and compatibility helper required by CLI
1.0.13. The CLI advertises workflow capability 3 and runs Claude, Muse Code, and
Codex participants under the workflow controller.

Publish wire before CLI. Verify the candidate CLI against the actual published
wire dependency with `pnpm verify:packaged --cli-only --registry-wire` before
publishing CLI. Install both canonical machines from npm and verify capability 3
before enabling the web/mobile deployment jobs. Existing sessions and account
keys must survive; retain immutable old runtime installations.

## Validation

- Frozen dependency installation passed.
- Wire prepublish: 34 tests passed.
- CLI prepublish: build and 1,057 tests passed.
- Server prepublish: build, production web export, and 112 tests passed.
- Agent build and brand verification passed.
- Actual 390 × 844 browser changelog check passed; [screenshot](../evidence/workflow-providers/release-changelog.png).
- [Feature E2E and independent UI review](../evidence/workflow-providers/README.md) cover all three providers, encrypted persistence, permission boundaries, cancellation, and mobile keyboard behavior.

Production deployment and registry installation results are recorded in the release PR.
