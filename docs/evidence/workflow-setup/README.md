# Workflow setup regression

Validated on 2026-09-13 from `origin/main` at `4a9b154f`, using the isolated `grand-island` environment, real account encryption/settings, real daemon RPC and Codex, and a separate committed Git fixture. Production services and ongoing user sessions were not restarted or modified.

## Reproduction

With an authenticated account containing no agents, enable Experimental Features and Workflows, open Workflows, and press Create workflow. Previously, creation stopped with “Create at least five distinct Codex agents…” while the visible machine buttons only filtered run history. Selecting the machine never opened setup. [Before: empty library](before-empty-library.png).

## Validation results

- `pnpm --filter talos-app typecheck` — passed.
- `pnpm --filter talos-app exec vitest run` — **89 files / 903 tests passed**, including 14 new regression cases covering starter identities, atomic save validation, saved-agent selection, per-step errors, catalog failures, timeout/retry, stale responses, and reconnection.
- `pnpm verify:brand` and `git diff --check` — passed.
- Fresh-account mobile web: Create workflow → select real machine → discover actual Codex models → choose GPT-5.6-Sol / low → prepare starter team → edit planner name/instructions → configure criteria/check → save → task/project form appears directly → start real run.
- Empty name, missing criteria, and missing task/project display actionable errors and keep the relevant form open.
- Cancelling a subsequent starter-team draft leaves exactly the original five agents and one workflow. Reusing those saved agents reaches the Team step with the edited identity. No new agents are saved on cancellation.
- Stopping the real fixture daemon produces an explicit offline message and disables both setup continuation and run start. Restarting that daemon reloads models and enables continuation without leaving setup.
- iPhone 17 Pro simulator / iOS 26.1: actual native taps select the machine, load models, reuse the five synchronized identities, open Purpose, type a workflow name, and advance with one Continue tap while the field is focused. Cancel, edit the saved workflow, advance through its steps, and Save opens the task/project form. This used a simulator hardware keyboard; an on-screen keyboard and a physical device were not tested.
- Native validation used the existing development binary with this branch’s JavaScript loaded from isolated Metro on port 49544. No native code changed. Android and Tauri were not exercised.

## Complete real workflow

Run `b17203e4-90dc-4f02-8a47-bb010cb55206` completed after **8 Codex turns**, with two planner approvals, one execution, two reviewer approvals, and the coordinator’s real Python completion check passing. All participants used the selected live model `gpt-5.6-sol` with `low` effort.

The worktree’s `result.txt` bytes were exactly `talos workflow setup verified\n`. `git status --porcelain` in the original fixture was empty, and no `result.txt` existed there. Editing the saved workflow afterwards did not alter this run’s frozen definition.

## Screenshots

| Flow | Evidence |
| --- | --- |
| Machine discovery and starter-team configuration | [Mobile web](setup-live-models.png), [desktop](setup-desktop.png) |
| Review configured team and completion check | [Mobile web](workflow-review.png) |
| Saved workflow opens task/project form | [Mobile web](ready-to-start.png), [native iOS](saved-to-run-ios.png) |
| Five identities saved in Agent Library | [Desktop](saved-agents-desktop.png) |
| Native saved-team reuse and progression | [Machine/team](setup-saved-agents-ios.png), [Team step](team-ios.png) |
| Real run accepted and completed | [Started](run-started.png), [complete mobile](run-complete-mobile.png), [complete desktop](run-complete-desktop.png) |
| Offline machine feedback | [Mobile web](machine-offline-mobile.png) |

The gear in native screenshots is Expo’s development overlay. Screenshots show local fixture identities and paths, never authentication URLs or credentials.

## Repeat

1. Build wire with `pnpm --filter @ahmadposten/talos-wire build`, then create an isolated account using `pnpm env:up --template authenticated-empty --no-switch`. Keep its authenticated URL private. Use a terminal without inherited session-routing environment variables.
2. Open that environment’s authenticated web URL in agent-browser. Enable Experimental Features and Workflows through Settings → Features, then open Workflows. Do not create any agents first.
3. Run `PLAYWRIGHT_MODULE=/absolute/path/to/playwright CDP_URL=http://127.0.0.1:<browser-cdp-port> WORKFLOW_MACHINE='<displayed machine name>' node scripts/evidence/workflow-setup.cjs` from the repository root. The helper creates a committed temporary fixture and exercises the UI through actual workflow completion. It uses GPT-5.6-Sol / low from the live catalog and will spend real Codex usage.
4. For iOS, launch the Talos development app against an isolated Metro process using the environment’s private development credentials, then open `talos://workflows`. Native evidence was captured with `idb ui tap`, `idb ui text`, `idb ui describe-all`, and `xcrun simctl io <udid> screenshot`.
5. Stop only the test environment with `pnpm env:down <environment-name>`; stop any additional isolated Metro process separately.

The checked-in helper generalizes the browser commands used for this validation. Cancellation, daemon offline/recovery, saved-team reuse, and native checks were additional real UI checks, not mocked by the helper.
