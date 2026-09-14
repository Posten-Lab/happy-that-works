# Workflow providers and interface validation

This change replaces inline, expanding agent forms with a focused editor and Provider → Model → Effort selectors. Stage cards show the sequence and agent identities; stage details, reordering, and removal live under Stage settings. New provider runs require coordinator capability 3.

## Status

**Claude authentication and the full mixed-provider execution flow now pass.** After refreshing the local login, Claude completed planning, consolidation, voting, and execution, followed by Muse review/execution and Codex final review. No production deployment or npm publication was performed.

## Real execution evidence

Isolated authenticated-empty environment `sharp-maple`, local API, encrypted participant sessions, installed provider tools, and temporary Git fixtures:

- `source environments/data/envs/sharp-maple/env.sh`
- `pnpm exec tsx --tsconfig packages/talos-cli/tsconfig.json scripts/evidence/workflow-providers.mts --without-claude`
- Run `eb0126d7-45eb-43bb-895f-7eae5eea0a2a`: **complete**, five stages, seven real turns. Codex planned/consolidated/voted and created `stage one`; Muse reviewed, then changed the artifact to `stage two`; Codex performed final review. Final checks passed, encrypted disk reload succeeded, source checkout remained clean.
- Default invocation (without `--without-claude`), run `776d69b6-d1c9-4af0-9515-583f38ea39e5`: **complete**, five stages and seven real turns using Claude planning/consolidation/voting/execution, Muse review/execution, and Codex final review. Final checks, encrypted reload, and clean source assertions passed. The initial Claude attempt exposed a JSON Schema draft incompatibility (fixed with draft-7) and expired local authentication (resolved by a fresh login).
- Real Muse execution exposed a trailing native reminder overwriting the final answer. Only native agent-message items now supply the structured answer; a regression test covers this.
- Real test participants exposed ordinary session recovery attempting to resume completed workflow agents. Managed participants no longer create ordinary recovery checkpoints, existing checkpoints are durably stopped during daemon startup and skipped, and manual resume directs users to the workflow controller.

- `scripts/evidence/workflow-provider-boundaries.mts`: actual Muse read-only turn could not create or change fixture files; cancellation after native session creation settled in 676 ms.
- `scripts/evidence/workflow-provider-boundaries.mts --claude`: read-only session `cmu10qjc70057riujzqccktdy` left both fixture files unchanged. Executor session `cmu10qxo0006friujh795whbi` attempted an outside-worktree Write (denied by the permission callback) and Bash redirection (denied by the OS sandbox), then successfully wrote `safe\n` inside the worktree. The outside canary remained unchanged. Cancellation session `cmu10r6b2007jriujcqsfwgmj` settled in **2,874 ms**.
- The initial Claude boundary probe returned malformed StructuredOutput arguments (missing the required `findings` field) and was rejected without accepting a result. A clarified probe specifying separate required arguments passed. This is an observed model-output failure; the adapter continues to fail closed on invalid results.

## Compatibility

`node scripts/evidence/workflow-provider-compat.cjs` reads actual encrypted settings saved through the UI and bundles the previously shipped parser from `7130fa064cda06c1c0e73faa306dcf38bffffd95`. Existing libraries survive, and mixed-provider workflows/Muse identities survive an older client changing unrelated settings. Older clients may discard optional display labels; runtime identifiers remain intact. This checks synced settings, not unsynced pending edits during a downgrade.

Mixed workflows are stored in the separate V3 settings field and encrypted disk directory. V1/V2 RPC views exclude them and reject control/start before mutation. Codex-only workflows retain the previous paths. When a paused run gains another provider, its legacy checkpoint is retired before promotion; later all-Codex replacements retain the V3 path. `scripts/evidence/workflow-provider-storage.mts` verified this using the completed real-run fixture, authenticated encryption, and the actual previously shipped store loader: old resume disabled, one current run, no stale checkpoint revival.

## UI/UX loop

An initial independent review identified the nested editor and expanding lists as blocking usability problems. A separate implementing agent redesigned the interface. A second independent reviewer exercised the actual browser flow, reported accessibility/display-label issues, and rechecked corrections. Final review: **pass**; see [review.md](review.md).

Browser checks: all three providers, live model catalogs, effort reset, Haiku without effort controls, three planners, long names, cancel rollback, save/reopen, light/dark, selected radio semantics, readable model labels. The standalone Agent Library uses the same picker and was also exercised.

Native iPhone 17 Pro / iOS 26.1 checks: agent name focused with software keyboard visible; footer remained above keyboard; Provider dismissed keyboard; Muse selection returned to the same editor; cancel closed the draft. The native check exercised the offline-catalog state; live catalog and persisted selection checks were performed in the browser.

| Evidence | What it shows |
| --- | --- |
| [Dark agent editor](review-explicit-dark-agent.png) | Focused form and fixed action |
| [Provider picker](review-explicit-dark-picker.png) | Bounded exclusive selection |
| [Three planners](review-recheck-model-labels-dark.png) | Long identities and readable model names |
| [Light editor](review-agent-light.png) | Light theme |
| [Haiku effort](review-haiku-light.png) | Unsupported effort stays disabled |
| [Native keyboard](native-editor-keyboard.png) | Action remains above software keyboard |
| [Native provider picker](native-provider-picker.png) | Keyboard dismissed and selected radio announced |
| [Agent Library runtime](agent-library-runtime.png) | Shared picker in standalone wizard |

## Automated checks

- `pnpm --filter @ahmadposten/talos-wire test`: 34 passed.
- `pnpm --filter talos-app test`: 911 passed.
- `pnpm --filter talosapp test`: 1,056 passed; the subsequently expanded workflow storage/RPC suite passed all 36 tests. Provider authentication-environment/output regressions passed all 5 tests after the final credential-preservation adjustment.
- App and CLI type checks passed; `git diff --check` passed.

No credentials, authenticated URLs, raw account settings, or full participant logs are included in this evidence bundle.
