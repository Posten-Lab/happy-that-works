# Workflow recovery validation

The workflow runtime previously replaced the provider's terminal error with a generic “Codex reported an error” message. A Spark usage limit therefore looked like an unexplained workflow failure, and retrying immediately failed again. Participant replacement also restarted planning even when only the interrupted builder's model needed changing.

The fix retains the terminal provider message and reset time, offers a model-only Build retry, preserves planning approvals and completed steps, records each attempt's model, and tells the new attempt to inspect partial edits. The full step sequence appears above the recovery controls. A dedicated RPC method fails explicitly on older daemons.

Model-only recovery is limited to an interrupted executor with no completed contributions under that identity. It cannot change the provider, assignment, instructions, reviewers, acceptance criteria, or check gates. Other participant changes still require replanning.

## Checks

- `pnpm --filter talosapp exec vitest run --project unit src/workflows` — 73 tests passed, including terminal provider errors, transient error recovery, model validation, concurrent decisions, retained approvals, and legacy/editable workflow recovery.
- `pnpm --filter talos-app exec vitest run sources/workflows` — 56 tests passed.
- `pnpm --filter @ahmadposten/talos-wire exec vitest run src/workflows.test.ts` — 5 tests passed.
- `pnpm --filter talos-app typecheck` — passed.
- CLI and wire builds — passed.

## Real end-to-end flow

Run from the feature checkout with a dedicated `authenticated-empty` environment:

```sh
WORKFLOW_RECOVERY_CASE=restart \
WORKFLOW_RECOVERY_ENV=/absolute/checkout/environments/data/envs/grand-star \
PLAYWRIGHT_MODULE=/path/to/playwright-core \
node scripts/evidence/workflow-recovery.cjs
```

The script uses real Codex turns, the real daemon, encrypted RPC through the local standalone server, Metro, and Chrome at 390×844 and 1440×1000. Spark must actually be rate limited on the test account; no provider response or HTTP request is mocked. The planner proposes, consolidates, and approves a small file change. Spark fails with its real usage limit. The daemon restarts and returns the same checkpoint. The app displays all steps and the actionable error, then the user switches to Sol through the model picker. Sol writes the file, the shell check verifies it, and the independent reviewer approves. Reloading the page retains completion. Assertions ensure no planning task was replayed and the approved plan did not change.

The final machine-readable result is in [validation.json](validation.json).

- [Interrupted workflow on phone](interrupted-mobile.png)
- [Retained planning result](preserved-plan-mobile.png)
- [Model selection and resume](choose-model-mobile.png)
- [Completed workflow on phone](complete-mobile.png)
- [Completed workflow on desktop](complete-desktop.png)

The production incident's private task, source code, and credentials are excluded from this evidence. Public evidence uses only the isolated `result.txt` task.
