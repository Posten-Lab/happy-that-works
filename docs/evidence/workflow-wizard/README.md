# Workflow wizard and launch validation

Validated on 14 September 2026 from `codex/workflow-wizard`, based on `ad803dd4` (latest main). All services and accounts used below are isolated development fixtures; production services, global CLI installations, and existing user sessions were not modified.

## Product flow

Workflows is a phone tab and a desktop sidebar destination. Opening it shows saved workflows and an explicit neutral Create action. Create/Edit is a four-step wizard: Basics, Team, Finish, Review. The Team stage retains editable stages, up to three planners/reviewers, and provider → model → effort configuration. Saving returns to the library. Run opens a separate task/machine/project form with the same picker components used by regular sessions.

## Verification

- `pnpm --filter talos-app typecheck` — passed.
- `pnpm --filter talos-app exec vitest run` — 94 files / 943 tests passed.
- Phone and desktop navigation: seven real-browser checks, including both experimental flag combinations and selected destination semantics. See [navigation results](nav-validation.json).
- Actual browser create/save: empty-name/team validation, three live providers, model/effort selection, add/reorder/remove stage, Review → Edit retaining changes, atomic save returning to library, and shared project picker. No browser page exceptions.
- Actual browser launch: nonexistent directory → readable error → original request confirmed absent → fix through the shared picker → Start. Run `b105013b-2d2b-4742-b7c9-b13bfc4d48bc` completed all stages and its completion check using Codex, Claude and Muse. Source project remained clean and untouched. See [launch results](launch-validation.json).
- Real-service recovery: matching created/absent receipts, a simulated device-storage write failure sends zero RPC starts, and the subsequent request sends exactly one. See [recovery results](launch-recovery-validation.json).
- Regular-session prompt and project were unchanged after configuring a workflow in the same browser. Both screens use the extracted shared picker components.
- iPhone 17 Pro simulator, iOS 26.1: software keyboard exercised on the lower Basics description, deep agent-reference Markdown, Finish check command, launch prompt and project picker. The focused text/caret and action remain accessible. Agent confirmation works with the keyboard open. Native unsaved draft was discarded after validation.
- Independent Codex reviews found and drove fixes for Team density, runtime error diagnostics, action-error persistence, a late-response receipt race, partial machine-history loading and keyboard clearance. See [review loop](review.md).

## Reproduce

Use an isolated environment created with `pnpm env:up --template authenticated-empty`. Start its built CLI daemon with `TALOS_HOME_DIR` and server settings from that environment if the helper reports a readiness timeout. Do not install or relink the global CLI. The browser scripts require Playwright and an installed Chrome channel; set `PLAYWRIGHT_MODULE` to its module location when Playwright is outside this checkout.

```sh
PLAYWRIGHT_MODULE=/path/to/playwright WORKFLOW_E2E_ENV="$PWD/environments/data/envs/<name>" node scripts/evidence/workflow-navigation.cjs
PLAYWRIGHT_MODULE=/path/to/playwright TALOS_E2E_ENV="$PWD/environments/data/envs/<name>/environment.json" node scripts/evidence/workflow-wizard.cjs
PLAYWRIGHT_MODULE=/path/to/playwright WORKFLOW_E2E_ENV="$PWD/environments/data/envs/<name>" node scripts/evidence/workflow-launch.cjs
PLAYWRIGHT_MODULE=/path/to/playwright WORKFLOW_E2E_ENV="$PWD/environments/data/envs/<name>" node scripts/evidence/workflow-session-picker.cjs
PLAYWRIGHT_MODULE=/path/to/playwright WORKFLOW_E2E_ENV="$PWD/environments/data/envs/<name>" node scripts/evidence/workflow-launch-recovery.cjs
```

The launch script seeds one encrypted fixture workflow, creates a temporary committed Git project, and runs real provider turns. The creation script saves a uniquely named test workflow through the UI. Credentials remain in local private files and are never included in evidence. Native interaction used `idb ui` and screenshots used `xcrun simctl io`; screenshot hashes and dimensions are in [manifest.json](manifest.json).

## Screenshots

| Screen | Evidence |
| --- | --- |
| Phone navigation and library | [Home](nav-phone-home.png), [Library](library-saved.png) |
| Desktop destination | [Desktop library](nav-desktop-library.png) |
| Creation wizard | [Basics](wizard-basics.png), [Team](wizard-team-top.png), [Finish](wizard-finish.png), [Review](wizard-review.png) |
| Agent configuration | [Provider, model and effort](agent-provider-model-effort.png) |
| Launch and completion | [Ready](launch-ready.png), [Project picker](launch-project-picker.png), [Bad-path recovery](launch-path-error.png), [Complete](launch-complete.png) |
| iOS software keyboard | [Basics](native-basics-keyboard.png), [Agent reference](native-agent-reference-keyboard.png), [Finish](native-finish-keyboard.png), [Run](native-run-keyboard.png), [Project](native-project-keyboard.png) |

The round-one screenshots intentionally preserve reviewer findings; the named final screenshots above contain their corrections. The floating gear in native screenshots belongs to the Expo development client and is absent from the production app.
