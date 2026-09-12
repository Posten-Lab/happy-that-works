# Experimental workflow validation

Validated on macOS on 2026-09-12 against an isolated Talos API, Expo web app, authenticated CLI daemon, and real Codex app-server processes. The account and machine are test-only; no production session, deployment or npm publication was changed. Browser checks used Chromium via Playwright/agent-browser at 390 × 844 and 1440 × 1000. Native iOS/Android and Windows were not exercised.

## Automated validation

```sh
pnpm --filter talosapp test
pnpm --filter talos-app typecheck
pnpm --filter talos-app exec vitest run
pnpm --filter @ahmadposten/talos-wire test
pnpm verify:brand
git diff --check
```

Results: 1,034 CLI tests across 117 files, 878 app tests across 85 files, and 29 wire tests across three files passed. CLI build includes TypeScript checking; app typecheck and brand verification passed. Focused workflow tests were repeated after adding the configured completion commands to participant prompts.

Tests cover unanimous/versioned plan approval, failed-check gating even with unanimous reviewers, independent rereview after corrections, workspace mutation invalidation, clarification delivery, stale actions, cancellation, restart without execution replay, checkpoint write failures, shutdown cleanup, idempotent/conflicting starts, environment isolation, optional Codex configuration maps, encrypted private storage, and real Git worktree/submodule handling.

## Real correction workflow

Local services: API `localhost:52098`, web `localhost:52099`, isolated environment `warm-dune`. Started using the repository environment tooling (`pnpm env:new`, `pnpm env:up`). Authenticated browser credentials were loaded privately and are deliberately excluded from evidence.

1. Enabled experimental features, Agent Library, and Workflows in the real UI. Created five distinct Codex agents through the agent wizard: Aster, Kepler, Forge, Iris, Sentinel, each using the available `gpt-5.6-sol` model at low effort.
2. Created “Consensus delivery” through all four workflow wizard steps. Assigned two planners, Forge as executor, two reviewers, and required human approval after plan consensus.
3. Configured a real completion command:

   ```sh
   python3 -c "from pathlib import Path; assert Path('result.txt').read_text() == 'WORKFLOW_E2E_OK\n'; print('WORKFLOW_CHECK_PASSED')"
   ```

4. Started run `eb29e8f3-bf29-47bc-9dcb-327b596809c3`. Its explicit regression task instructed the first execution to write `WORKFLOW_NEEDS_FIX`, so that both the real check and independent reviewers had a concrete defect to reject.
5. Both planners proposed, the plan owner consolidated, and both voted to approve plan v1. No executor ran before the user checkpoint. A daemon rebuild/restart retained that checkpoint; a separately authenticated fresh browser context saw the same agreed plan.
6. Approved the agreed plan through the UI. The actual command exited 1 on the deliberately incorrect file. Both reviewers returned `changes` with blocking findings. The executor received those findings and corrected the file. Both reviewers reassessed the corrected revision and approved; the actual command exited 0 with `WORKFLOW_CHECK_PASSED`.
7. Final verified workspace hash: `8cf61323c55953a2701fc681643f192615dfdd6a362f2a45b01e0371f1742a9d`. The original Git checkout stayed clean; output exists only in the retained run worktree.

An early attempt exposed a null optional Codex configuration map and stopped before work. That bug was corrected, regression-tested, and the same run resumed explicitly. Participant output originally used a legacy message shape; the final runner sends the existing session protocol, and a subsequent real run verified rendered messages and tool calls.

## Recovery and participant visibility

- Rejected a start with an invalid project path, reloaded the browser, recovered the pending request identity, asked the original machine for its status, and unlocked the form only after the machine reported that no run existed.
- Started run `0bbd2372-bbab-44f1-a5e3-77909af90289` through the same UI. Inspected its rendered participant output and tools through a normal Talos session. Workflow sessions show an “Open workflow” control instead of a separate composer.
- Paused its real executor through the UI. The task became `interrupted`; `result.txt` and the worktree were preserved. Inspected the exact bytes and Git status, then supplied that inspection as a clarification and resumed through the UI. A subsequent daemon handoff interrupted a reviewer, retained the completed execution and successful check, and waited for explicit resume. The second run then completed with both reviewers approving the unchanged verified revision.
- Codex reviews identified missing session heartbeats, a Windows directory-flush incompatibility, shutdown not awaiting participant cleanup, oversized replacement validation, and original-path retry issues. All were fixed; focused regression tests cover cleanup, configuration, replacement validation, and request identity. Shutdown now waits for bounded settlement and prevents late state writes after handoff.

A final Codex static follow-up review found no remaining concrete defects in the reviewed fixes. Test execution and real E2E validation were performed separately as recorded above.

`run-results.json` contains sanitized durable run receipts: decisions, versions, check results, interruption records, and event summaries. It excludes authentication, raw prompts, private agent configuration, and absolute user paths.

## Screenshots

- [Team assignment on mobile](team-mobile.png)
- [Workflow review step](review-workflow-mobile.png)
- [Planner consensus](planner-consensus-mobile.png)
- [Checkpoint from a fresh browser context](recovered-checkpoint-mobile.png)
- [Pending start recovery after reload](start-recovery-after-reload.png)
- [Paused real execution](paused-execution-mobile.png)
- [Rendered participant session](participant-session.png)
- [Completed correction run](completed-mobile.png)
- [Completed run after pause and daemon handoff](recovered-run-complete-mobile.png)
- [Successful real completion command](checks-passed-mobile.png)
- [Unanimous reviewer approval on mobile](review-approved-mobile.png)
- [Reviewer workspace on desktop](review-approved-desktop.png)
