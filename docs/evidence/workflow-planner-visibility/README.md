# Planner visibility validation

Started from `origin/main` at `5b5a44c5` in a fresh `feat/workflow-planner-visibility` worktree, then rebased onto `c008d4cb`. Automated checks and real-service browser history/navigation validation were rerun after the rebase. All runs used an isolated local server, web app, CLI home, and temporary committed Git project. Production sessions and installations were not changed.

## Real end-to-end flow

`scripts/evidence/workflow-planner-visibility.cjs` seeds an encrypted test definition and starts it through the actual phone-sized browser UI. Three real Codex planners inspect a small file-writing task. The fixture deliberately omits an exact-byte check from the first plan, allowing the planners to record actual blocking findings. The coordinator hands those findings to the plan owner, who revises the plan; the original assessors explicitly verify their findings against the second version. The user checkpoint is approved through the UI, then actual execution and review complete the run.

The script asserts source-session IDs and handoff references, explicit addressed/verified responses, original-transcript navigation, plan comparison, preserved planner history after completion, passing completion checks, a clean source repository, and no browser page errors. [Validation receipt](validation.json) records the actual run and outcomes. Outputs are not mocked and workflow status is not injected.

`scripts/evidence/workflow-planner-navigation.cjs` additionally checks rapid evidence switching, direct transcript switching, return to a filtered participant history, and phone/desktop rendering. See [navigation receipt](navigation.json).

## Automated checks

- App typecheck and CLI build/typecheck passed.
- App: 99 test files, 986 tests passed.
- CLI workflow suite: 7 files, 68 tests passed, including encrypted persistence and real filesystem/workspace tests.
- Wire: 5 files, 48 tests passed, including old-record compatibility, exact vote grouping, false-verification rejection, proposal objections, and explicit reopening.
- The coordinator regression parses the actual summary with `WorkflowRunSchema`, protecting against the malformed shortened finding caught during browser validation.

## Screenshots

- [All planners available during a live run](01-all-planners-live.png)
- [Original objection and fixed participant switcher](02-original-objection.png)
- [Original task transcript](03-source-transcript.png)
- [Votes on two different plan versions](04-resolution-history.png)
- [Plan comparison](05-plan-comparison.png)
- [Desktop source evidence](06-desktop-evidence.png)
- [Planner history after completion](07-history-after-completion.png)
- [Explicit verification history](08-verified-objection.png)
- [Desktop history and evidence drawer](09-desktop-history.png)

## Reproduce

After `pnpm install --frozen-lockfile` and building the wire package, create an isolated authenticated environment with `pnpm env:up --template authenticated-empty --no-switch`. Run its built CLI daemon using that environment's `env.sh`; the direct `daemon start-sync` command is suitable when a background service is not installed. Finish CLI builds before starting the daemon, since the development daemon can stop when its build changes.

```sh
WORKFLOW_E2E_ENV="$PWD/environments/data/envs/<name>" PLAYWRIGHT_MODULE=/path/to/playwright node scripts/evidence/workflow-planner-visibility.cjs
WORKFLOW_E2E_ENV="$PWD/environments/data/envs/<name>" PLAYWRIGHT_MODULE=/path/to/playwright node scripts/evidence/workflow-planner-navigation.cjs
```

The navigation script uses the run receipt at `/tmp/talos-planner-e2e-state.json`. Set `WORKFLOW_E2E_RESUME=1` on the first script to revisit its existing run and recapture evidence without launching more provider work. Credentials remain in the isolated environment's private files and are never copied into this evidence directory.
