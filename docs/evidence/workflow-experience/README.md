# Workflow experience: full visual and live-service evidence

This gallery replaces the earlier three-frame PR preview. It covers the library, all four creation steps (including lower content), all three provider configurations, saved-workflow launch, real participant sessions, running and completed views, and recovery.

The screenshots are captured from the app against an isolated local API and CLI daemon. Workflow progress and agent responses were not mocked or injected. Browser captures use Chrome at 390 × 844, 320 × 720, or 1440 × 1000. Native keyboard captures use the actual iPhone 17 Pro simulator running iOS 26.1 (402 × 874 points). Both dark and light themes are covered.

## What was exercised

- **Creation:** create/reuse named agents; provider → discovered model → supported effort; instructions and references; editable stage settings; add/remove/reorder a stage; three distinct planners and the cap; completion criteria, a real `node --test` check, manual plan approval, full review, save, and return to the library. An additional draft was explicitly discarded; saved libraries were unchanged.
- **Launch:** select a saved workflow, enter a prompt, choose a real machine and Git project using the same picker as regular sessions, and start through encrypted RPC. A real non-Git project rejection produces actionable copy and allows correction. The prompt grows from 156 to 240px and shrinks again; the desktop launch action is 240px wide.
- **Git status lifecycle:** completed participant transcripts no longer start persistent Git polling through ended agent sessions. A real executor transcript was reopened and observed for 35 seconds beyond the previous RPC timeout; no Git polling error or raw toast appeared. Ordinary session Git status remains covered by regression tests.
- **Sessions:** open actual planner/executor transcripts and return to the workflow; show a readable assignment and structured response while preserving the original content. Interim response JSON is not presented as an authoritative workflow decision. Normal-session prompt and directory drafts survive separate workflow setup.
- **Native keyboard:** name, agent reference, completion command, launch prompt and project input remain visible with the software keyboard open. The literal command `node --test` retains two ASCII hyphens. The native keyboard wizard was discarded and no native run was started.
- **Approval:** a separate real planning run verified that **Read agreed plan** selects Plan and scrolls its heading to y=175. That validation run was cancelled before execution.

## Real runs and limitations

The saved **Feature delivery** workflow uses Ada / Claude, Atlas / Codex, and Vega / Muse Code. It was created and launched through the app on a temporary dependency-free Node CLI project. The executor implemented the requested readiness report and its tests. Muse initially returned the schema plus an instance, then only the schema; Talos correctly stopped both attempts and kept the results and check evidence. After two explicit guidance/resume actions, Muse returned an independent approval and the run completed with **5 automated tests passed**. Both interventions are recorded in the [final run receipt](validation.json); this is not claimed as an uninterrupted autonomous run.

A separate original run exposed Claude's command-runner failure: the SDK generated a sandbox profile whose command arguments exceeded this Mac's ARG_MAX. The sandbox was not weakened and the SDK was not patched. An actual user-visible replacement with Codex preserved the existing files, required fresh planning approval, passed **8 tests**, and received Muse's independent approval. **Claude shell execution on this machine remains a known provider limitation.**

The recovery also exposed a Talos bug: an arbitrary provider error containing “limit” was treated as an exhausted workflow budget. The coordinator now recognizes actual budget conditions; real turn, planning, review and context limits remain enforced. This PR therefore includes a CLI change, which needs a later CLI release and daemon update to reach users.

Native evidence comes from a development client. One Fast Refresh websocket/bridge crash occurred while source files changed; the final keyboard pass used a clean restart with frozen native screens. This does not constitute an App Store build or physical-device validation. The shared web confirmation dialog lacks an explicit button role; the E2E used its visible confirmation text.

## Validation and reproduction

- App: `pnpm --filter talos-app test --run` — **968 tests / 98 files passed**; `pnpm --filter talos-app typecheck` passed.
- CLI: `pnpm exec vitest run --project unit src/workflows/coordinator.test.ts src/workflows/steps.test.ts` from `packages/talos-cli` — **43 tests passed**; CLI typecheck passed. Its global setup builds the CLI: do not run it while a daemon from this checkout is executing workflows.
- `git diff --check` and syntax checks for the evidence scripts passed.
- [Independent UI/UX review](review.md), [native keyboard measurements](native-keyboard-validation.json), [wizard checks](wizard-validation.json), [responsive/error/theme checks](supplement-validation.json), [ordinary-session draft checks](regular-session-validation.json), [participant-session checks](session-validation.json), [provider replacement run](recovery-validation.json), [plan-reading gate](gate-validation.json), and [screenshot manifest](manifest.json).

Use only an isolated environment. `WORKFLOW_E2E_ENV` is its absolute directory under `environments/data/envs/`; the scripts privately read its local credential file. Never put an authenticated URL or token in commands, logs, or the PR. Set `PLAYWRIGHT_MODULE` to an installed Playwright module if it is not available locally.

```sh
WORKFLOW_E2E_PHASE=create node scripts/evidence/workflow-experience.cjs
WORKFLOW_E2E_PHASE=run node scripts/evidence/workflow-experience.cjs
# After inspecting/resolving a real interruption through the app:
WORKFLOW_E2E_PHASE=results node scripts/evidence/workflow-experience.cjs
node scripts/evidence/workflow-experience-wizard.cjs
node scripts/evidence/workflow-experience-supplement.cjs
node scripts/evidence/workflow-experience-sessions.cjs
WORKFLOW_LAUNCH_RESULT=/tmp/talos-workflow-experience.json node scripts/evidence/workflow-session-picker.cjs
# Existing recovery run receipt, after actual participant replacement:
WORKFLOW_E2E_STATE=/path/to/private/recovery-receipt.json node scripts/evidence/workflow-provider-recovery.cjs
node scripts/evidence/workflow-plan-gate.cjs
```

The create phase resets only the isolated account's agent/workflow library after saving a private backup; it never deletes sessions, workflow state or project worktrees. The native pass used `idb ui text`, HID navigation, `idb ui describe-all`, and `xcrun simctl io … screenshot`; exact commands and measured clearances are in the native validation report. No production daemon, canonical npm package, deployed app or existing user session was changed.

## Screenshot gallery

Every top/lower pair is a different scroll position. The approval-anchor check and replacement run are labeled separately from the main walkthrough. Native creation fields belong to an intentionally unsaved keyboard-validation draft; native launch uses the saved workflow.

### Library and navigation

| Empty library | Saved workflow |
| --- | --- |
| <a href="01-library-empty.png"><img src="01-library-empty.png" width="320" alt="Empty library" /></a> | <a href="17-library-saved.png"><img src="17-library-saved.png" width="320" alt="Saved workflow" /></a> |

| Desktop library | 320px phone |
| --- | --- |
| <a href="18-library-desktop.png"><img src="18-library-desktop.png" width="320" alt="Desktop library" /></a> | <a href="48-library-narrow.png"><img src="48-library-narrow.png" width="320" alt="320px phone" /></a> |

| Light theme |
| --- |
| <a href="50-library-light.png"><img src="50-library-light.png" width="320" alt="Light theme" /></a> |

### Full wizard — Basics and Team

| Basics | Team before assignment |
| --- | --- |
| <a href="02-wizard-basics.png"><img src="02-wizard-basics.png" width="320" alt="Basics" /></a> | <a href="03-wizard-team-empty.png"><img src="03-wizard-team-empty.png" width="320" alt="Team before assignment" /></a> |

| Assigned team | Team lower section |
| --- | --- |
| <a href="10-wizard-team.png"><img src="10-wizard-team.png" width="320" alt="Assigned team" /></a> | <a href="11-wizard-team-lower.png"><img src="11-wizard-team-lower.png" width="320" alt="Team lower section" /></a> |

| Three distinct planners | Three-planner team lower section |
| --- | --- |
| <a href="45-wizard-three-planners.png"><img src="45-wizard-three-planners.png" width="320" alt="Three distinct planners" /></a> | <a href="45-wizard-three-planners-lower.png"><img src="45-wizard-three-planners-lower.png" width="320" alt="Three-planner team lower section" /></a> |

| Stage settings | Stage settings lower section |
| --- | --- |
| <a href="12-stage-settings.png"><img src="12-stage-settings.png" width="320" alt="Stage settings" /></a> | <a href="12-stage-settings-lower.png"><img src="12-stage-settings-lower.png" width="320" alt="Stage settings lower section" /></a> |

### Agent creation — provider, model, effort and instructions

| Saved-agent picker | Provider selection |
| --- | --- |
| <a href="04-agent-picker.png"><img src="04-agent-picker.png" width="320" alt="Saved-agent picker" /></a> | <a href="05-provider-selection.png"><img src="05-provider-selection.png" width="320" alt="Provider selection" /></a> |

| Claude models | Codex models |
| --- | --- |
| <a href="06-model-selection-claude.png"><img src="06-model-selection-claude.png" width="320" alt="Claude models" /></a> | <a href="06-model-selection-codex.png"><img src="06-model-selection-codex.png" width="320" alt="Codex models" /></a> |

| Muse models | Supported effort |
| --- | --- |
| <a href="06-model-selection-muse.png"><img src="06-model-selection-muse.png" width="320" alt="Muse models" /></a> | <a href="07-effort-selection.png"><img src="07-effort-selection.png" width="320" alt="Supported effort" /></a> |

| Claude configuration | Codex configuration |
| --- | --- |
| <a href="08-agent-configuration-claude.png"><img src="08-agent-configuration-claude.png" width="320" alt="Claude configuration" /></a> | <a href="08-agent-configuration-codex.png"><img src="08-agent-configuration-codex.png" width="320" alt="Codex configuration" /></a> |

| Muse configuration | Instructions and reference files |
| --- | --- |
| <a href="08-agent-configuration-muse.png"><img src="08-agent-configuration-muse.png" width="320" alt="Muse configuration" /></a> | <a href="09-agent-instructions.png"><img src="09-agent-instructions.png" width="320" alt="Instructions and reference files" /></a> |

### Full wizard — Finish and Review

| Completion criteria and checks | Approval and limits below |
| --- | --- |
| <a href="13-wizard-finish.png"><img src="13-wizard-finish.png" width="320" alt="Completion criteria and checks" /></a> | <a href="14-wizard-finish-lower.png"><img src="14-wizard-finish-lower.png" width="320" alt="Approval and limits below" /></a> |

| Review before saving | Review checks and approval below |
| --- | --- |
| <a href="15-wizard-review.png"><img src="15-wizard-review.png" width="320" alt="Review before saving" /></a> | <a href="16-wizard-review-lower.png"><img src="16-wizard-review-lower.png" width="320" alt="Review checks and approval below" /></a> |

### Launch a saved workflow

| Machine picker | Shared project picker |
| --- | --- |
| <a href="19-launch-machine-picker.png"><img src="19-launch-machine-picker.png" width="320" alt="Machine picker" /></a> | <a href="20-launch-project-picker.png"><img src="20-launch-project-picker.png" width="320" alt="Shared project picker" /></a> |

| Prompt and workspace | Launch team below |
| --- | --- |
| <a href="21-launch.png"><img src="21-launch.png" width="320" alt="Prompt and workspace" /></a> | <a href="22-launch-team.png"><img src="22-launch-team.png" width="320" alt="Launch team below" /></a> |

| Desktop launch | Real project validation error |
| --- | --- |
| <a href="23-launch-desktop.png"><img src="23-launch-desktop.png" width="320" alt="Desktop launch" /></a> | <a href="49-launch-project-error.png"><img src="49-launch-project-error.png" width="320" alt="Real project validation error" /></a> |

| Light theme launch | Unchanged regular-session picker |
| --- | --- |
| <a href="51-launch-light.png"><img src="51-launch-light.png" width="320" alt="Light theme launch" /></a> | <a href="56-regular-session-picker.png"><img src="56-regular-session-picker.png" width="320" alt="Unchanged regular-session picker" /></a> |

### Real planning and execution

| Main run: actual planning | Main run: planner transcript |
| --- | --- |
| <a href="24-run-planning.png"><img src="24-run-planning.png" width="320" alt="Main run: actual planning" /></a> | <a href="25-planner-session.png"><img src="25-planner-session.png" width="320" alt="Main run: planner transcript" /></a> |

| Separate real consensus gate: approval | Read agreed plan — actual anchor navigation |
| --- | --- |
| <a href="54-plan-approval-final.png"><img src="54-plan-approval-final.png" width="320" alt="Separate real consensus gate: approval" /></a> | <a href="55-plan-anchor.png"><img src="55-plan-anchor.png" width="320" alt="Read agreed plan — actual anchor navigation" /></a> |

| Main run: agreed plan ending | Recovery run: Codex executing after replacement |
| --- | --- |
| <a href="27-agreed-plan.png"><img src="27-agreed-plan.png" width="320" alt="Main run: agreed plan ending" /></a> | <a href="recovery-executing.png"><img src="recovery-executing.png" width="320" alt="Recovery run: Codex executing after replacement" /></a> |

| Recovery run: session while executor was active | Main run: completed executor transcript, reopened |
| --- | --- |
| <a href="recovery-executor-session.png"><img src="recovery-executor-session.png" width="320" alt="Recovery run: session while executor was active" /></a> | <a href="29-executor-session.png"><img src="29-executor-session.png" width="320" alt="Main run: completed executor transcript, reopened" /></a> |

| Main run: readable task assignment |
| --- |
| <a href="57-executor-assignment.png"><img src="57-executor-assignment.png" width="320" alt="Main run: readable task assignment" /></a> |

### Completed run — work, checks, plan, review and activity

| Main run complete | Delivered work and checks |
| --- | --- |
| <a href="30-run-completed.png"><img src="30-run-completed.png" width="320" alt="Main run complete" /></a> | <a href="31-completed-work.png"><img src="31-completed-work.png" width="320" alt="Delivered work and checks" /></a> |

| Plan tab | Plan and consensus lower section |
| --- | --- |
| <a href="32-completed-plan.png"><img src="32-completed-plan.png" width="320" alt="Plan tab" /></a> | <a href="33-completed-plan-lower.png"><img src="33-completed-plan-lower.png" width="320" alt="Plan and consensus lower section" /></a> |

| Review tab | Independent reviewer approval |
| --- | --- |
| <a href="32-completed-review.png"><img src="32-completed-review.png" width="320" alt="Review tab" /></a> | <a href="33-completed-review-lower.png"><img src="33-completed-review-lower.png" width="320" alt="Independent reviewer approval" /></a> |

| Activity tab | Activity and history below |
| --- | --- |
| <a href="32-completed-activity.png"><img src="32-completed-activity.png" width="320" alt="Activity tab" /></a> | <a href="33-completed-activity-lower.png"><img src="33-completed-activity-lower.png" width="320" alt="Activity and history below" /></a> |

| Desktop completion |
| --- |
| <a href="34-completed-desktop.png"><img src="34-completed-desktop.png" width="320" alt="Desktop completion" /></a> |

### Real interruptions and recovery

| Unreadable provider response: recovery guidance | Original malformed response retained in transcript |
| --- | --- |
| <a href="52-review-interrupted.png"><img src="52-review-interrupted.png" width="320" alt="Unreadable provider response: recovery guidance" /></a> | <a href="53-review-interrupted-session.png"><img src="53-review-interrupted-session.png" width="320" alt="Original malformed response retained in transcript" /></a> |

| Fresh approval after replacing the executor | Replacement run complete |
| --- | --- |
| <a href="recovery-fresh-plan-approval.png"><img src="recovery-fresh-plan-approval.png" width="320" alt="Fresh approval after replacing the executor" /></a> | <a href="recovery-complete.png"><img src="recovery-complete.png" width="320" alt="Replacement run complete" /></a> |

| Replacement run independent review | Actual 8-test output |
| --- | --- |
| <a href="recovery-review-detail.png"><img src="recovery-review-detail.png" width="320" alt="Replacement run independent review" /></a> | <a href="recovery-checks-output.png"><img src="recovery-checks-output.png" width="320" alt="Actual 8-test output" /></a> |

| Extra gate test cancelled before execution |
| --- |
| <a href="56-plan-gate-cancelled.png"><img src="56-plan-gate-cancelled.png" width="320" alt="Extra gate test cancelled before execution" /></a> |

### Native iPhone software keyboard

| Basics with keyboard | Agent reference and caret |
| --- | --- |
| <a href="40-native-basics-keyboard.png"><img src="40-native-basics-keyboard.png" width="320" alt="Basics with keyboard" /></a> | <a href="41-native-agent-reference-keyboard.png"><img src="41-native-agent-reference-keyboard.png" width="320" alt="Agent reference and caret" /></a> |

| Literal command and review action | Prompt caret and launch action |
| --- | --- |
| <a href="42-native-finish-keyboard.png"><img src="42-native-finish-keyboard.png" width="320" alt="Literal command and review action" /></a> | <a href="43-native-run-keyboard.png"><img src="43-native-run-keyboard.png" width="320" alt="Prompt caret and launch action" /></a> |

| Project input and selection action |
| --- |
| <a href="44-native-project-keyboard.png"><img src="44-native-project-keyboard.png" width="320" alt="Project input and selection action" /></a> |

### Release changelog

The release entry was exercised at 390 × 844 after deployment was authorized. [Validation](release-changelog-validation.json).

<img src="66-release-changelog.png" width="320" alt="User-facing workflow release notes" />
