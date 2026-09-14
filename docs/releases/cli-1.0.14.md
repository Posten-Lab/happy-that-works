# Talos CLI 1.0.14 and workflow experience rollout

This release accompanies PR #53. The CLI fixes recovery when a provider error mentions an operating-system argument limit; the coordinator now distinguishes that failure from actual exhausted workflow budgets. Existing planning/review limits, checks, approvals, run state and participant sessions remain protected. Wire remains at the already-published 0.1.4; no wire or agent package release is needed.

The app gains a dedicated workflow destination, a four-step creation wizard, editable agent teams, shared machine/project selection, clearer live progress and participant transcripts, keyboard-safe inputs, and actionable failures. Viewing an ended participant no longer leaves a Git status poll tied to its closed RPC connection. The [full product walkthrough](../evidence/workflow-experience/README.md) and [independent visual review](../evidence/workflow-experience/review.md) record actual UI and provider execution.

## Preparation

- Frozen dependency installation passed.
- Wire prepublish: 34 tests passed.
- CLI prepublish: build and 1,072 tests passed.
- Server production prepublish: runtime, web export and 112 tests passed.
- Agent build and brand verification passed.
- CLI candidate installed and exercised with isolated and hoisted layouts against its actual registry wire dependency. Version, diagnostics, native tools and search launchers passed.
- Candidate tarball metadata reports talosapp 1.0.14 and wire 0.1.4. Tool notices are present; local credentials, tools/server and tools/webapp are absent.
- User-facing changelog was generated with the canonical parser and exercised at 390 × 844. [Screenshot](../evidence/workflow-experience/66-release-changelog.png).

The first full package matrix attempt exhausted local disk space; inactive generated package-test installations were removed while retaining artifacts, logs, session state and active runtime directories. The retry result and final CI status are recorded in the PR before merging.

## Publication and rollout

Publish only CLI with `pnpm release cli --publish`, using the canonical private publishing credential. npm upload scanning can delay registry visibility; inspect the registry before retrying an upload. Verify a real registry installation before updating machines.

Immediately before merge, preserve and temporarily pause the three idle Jenkins deployment jobs to coordinate order. Publish and verify CLI, install exact registry packages on Mac and Dell, and activate immutable runtimes with session-preserving service settings. Verify account/settings bytes, existing session PIDs, daemon versions and encrypted connectivity. Restore the original job states, then deploy web/API and a guarded production OTA from the recorded merge commit. A forced OTA compatibility failure must not silently launch a native build.

Retain immutable CLI 1.0.13 installations and each Jenkins component's deployment receipts for rollback. Never restore old account or daemon-state files over live state. No datastore, namespace, DNS, encryption-secret or store-identity change is part of this release. Final npm, machine, Jenkins and public-health results are recorded in PR #53.
