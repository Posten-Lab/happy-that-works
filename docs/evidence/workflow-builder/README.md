# Editable workflow validation

Validated 2026-09-13 from `codex/workflow-builder`, based on main `27285105`. All activity used a separate local account, API, daemon home, Git fixture, and Metro instances. Production daemons and user sessions were not changed.

## Automated checks

| Command | Result |
| --- | --- |
| `pnpm --filter @ahmadposten/talos-wire test` | 34 tests passed |
| `pnpm --filter talos-app typecheck` | Passed |
| `pnpm --filter talos-app exec vitest run` | 908 tests passed |
| `pnpm --filter talosapp exec vitest run --project unit` | 1,050 tests passed, including CLI build/typecheck |
| `git diff --check` | Passed |

Coverage includes legacy behavior, stage order and identity validation, three-planner voting, repeated identities across distinct stages, per-step review correction loops, human approvals at multiple planning steps, cancellation, restart without replay, stale artifact rejection, atomic replacement, v2 storage isolation, v1/v2 RPC routing, and atomic workflow/agent library writes.

## Real browser and Codex execution

Start an isolated environment with `pnpm env:up --template authenticated-empty --no-switch`; open its private authenticated URL using agent-browser. Keep that URL and its credentials out of logs and evidence. The checked-in [browser script](../../../scripts/evidence/workflow-builder.cjs) accepts `PLAYWRIGHT_MODULE` and `CDP_URL` for the browser started by agent-browser.

At 390×844 and 1280×1000, exercised Create workflow, live model/effort selection, creation of six agents from an empty library, Markdown reference instructions, removal/reinsertion of a planner, stage addition/reordering, assignments, intermediate checks, and final completion checks. The planner Add control disappears at three. Saved the definition and started it through the UI with actual encrypted RPC, Codex, Git worktrees, and shell checks.

The sequence Plan (3) → Build (1) → UI review (2) → Polish (same executor) → Final review (same 2 reviewers) completed in **13 real Codex turns**. Build wrote `stage one\n`; its gate checked and approved that revision. Polish wrote `stage two\n`; final checks and both reviewers approved the new revision. Source README and original checkout remained unchanged. The final bytes and distinct reviewed artifact hashes were independently checked through encrypted RPC and filesystem reads. See [execution receipt](execution.json).

The initial automation reached completion but its final evidence click used the old button role for the Work tab. Updated it to the new checkbox role and reran the completion/check assertion successfully. After the compatibility and scroll-return changes, separately reran editing, cancelling a new agent, saving, reloading the saved definition, and opening the completed run using the v2 RPCs.

## iOS simulator

Used an existing Talos development binary on iPhone 17 Pro / iOS 26.1, loading this worktree's JavaScript from an isolated Metro instance. With `idb ui tap`/`describe-all` and `xcrun simctl io ... screenshot`, edited the browser-created workflow, created a third intermediate reviewer inline using GPT-5.6-Sol / low, added and removed a sixth review step, moved the execution step up and back down, and saved.

A real encrypted account read confirmed five stages in the intended order, three reviewers in the intermediate gate, seven saved agents, an empty legacy workflow library, and the definition in `workflowLibraryV2`. The completed run retained its frozen original two-reviewer gates and 13 turns. Native editor cancellation/scroll-return was retested with a freshly loaded bundle.

## Compatibility

Seeded capability 1 and a custom display name on the isolated existing machine, restarted only its daemon, and verified capability 2, preserved display name, and real workflow/model RPCs. Legacy list RPC hides custom runs; legacy detail/action RPCs refuse them before mutation. V2 RPCs load the completed run and its evidence.

Bundled the **unchanged older app settings implementation** from main `27285105`, decoded the current real account settings, applied an unrelated preference through that implementation, encrypted its payload, and posted with the current settings version to the local API. A fresh read confirmed that all editable workflows and all agents survived unchanged. See [compatibility receipt](compatibility.json). The optional full older-app browser harness stalled during Metro startup; the serializer/server roundtrip replaced that check, and no older-app GUI pass is claimed.

## Screenshots

- [Create workflow action on mobile web](workflow-home-mobile.png)
- [Planner team and controls](steps-mobile.png)
- [Desktop builder](builder-desktop.png)
- [Custom execution/review sequence](custom-sequence-desktop.png)
- [Inline agent editor on web](agent-editor-mobile.png)
- [Inline agent editor on iOS](native-agent-editor.png)
- [Saved workflow on iOS](native-saved.png)
- [Three-reviewer step on iOS](native-three-reviewers.png)
- [Editor return on mobile web](editor-return-mobile.png)
- [Editor return on iOS](native-editor-return.png)
- [Completed run on desktop](completed-desktop.png)
- [Completed run on mobile web](completed-mobile.png)

Physical iOS devices and Android were not exercised. New stages require the updated wire/CLI and workflow capability 2; the app blocks unsupported coordinators. This PR has not been deployed or published to npm. See the [rollout order](../../workflows/editable-stages.md#compatibility-and-rollout).
