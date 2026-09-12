# Agent library validation — 2026-09-12

Source base: `9ac9ebe3` (`origin/main`, fetched before starting work).

Real local services in the isolated `agile-lagoon` environment:

- PGlite-backed Talos server: `http://localhost:61868`
- Expo web: `http://localhost:61869`
- Built CLI daemon with a separate `TALOS_HOME_DIR` and newly seeded test account.
- Real installed Codex runtime, model `gpt-5.6-sol`, low reasoning effort, read-only permissions.

No HTTP, socket, model catalog or model responses were mocked. Browser actions used agent-browser, plus Playwright attached to that browser for the native file chooser and a fresh browser context. Authentication material stayed in ignored environment files and was not included in screenshots or this evidence.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm env:up --template authenticated-empty --no-switch
pnpm --filter talos-app exec vitest run
pnpm --filter talos-app typecheck
git diff --check
```

The environment helper did not register a daemon automatically. The isolated daemon was started with `node packages/talos-cli/bin/talos.mjs daemon start-sync`, using only this environment's home/server/web settings and removing inherited `TALOS_*`, `HAPPY_*`, `CODEX_*` and `CLAUDE_*` session variables first. An initial fixture inherited the invoking chat's fork variables; that fixture was stopped and deleted, and all response evidence below is from clean new sessions. Production daemons and sessions were not used for these tests.

## Observed flows

1. Direct `/agents` navigation while disabled displayed the experimental-feature gate.
2. Enabled both switches through Features; the library and curated templates appeared.
3. Customized Iris, entered test instructions, discovered live Codex models, selected Sol/low/read-only, reviewed and saved.
4. Launched a real session through the app. The response began `IRIS_AGENT_OK` and identified its saved reviewer role. The session displayed Iris v1 with the selected model.
5. Edited Iris to v2 and imported `iris-instructions.md` through the actual browser file chooser.
6. Disabled the library and confirmed direct navigation was blocked. Continued the existing session: it retained v1 and returned the original `IRIS_AGENT_OK` instruction marker.
7. Re-enabled the feature. A new v2 session returned both `IRIS_VERSION_TWO` and `MARKDOWN_REFERENCE_OK`, proving updated instructions and attached Markdown reached the provider.
8. A fresh browser context authenticated against the same isolated account and recovered the saved library and the original v1 session's snapshot/read-only permissions through real account/session sync.
9. Duplicated the saved agent, selected Claude/Sonnet from its live catalog and launched it. The session and snapshot were created, but Claude returned **OAuth session expired and could not be refreshed**. The user subsequently requested Codex instead. New library launches are now restricted to Codex; the failed Claude test is not counted as passing validation or required for this increment.

## Codex-only follow-up

After the user selected Codex for this increment, the updated wizard was exercised again against the real services. It displayed Codex with the machine's live model catalog and no Claude choice. The earlier Claude definition remained in the library with its start button disabled. A fresh Codex session returned both `IRIS_VERSION_TWO` and `MARKDOWN_REFERENCE_OK`, confirming the revised launch path and Markdown delivery. Tests and typechecking were rerun after the change.

## Codex review and retry regression

A read-only `codex review --base origin/main` found one P2 issue: after a post-spawn setup failure, editing the destination could cause the screen to validate a new machine but silently reuse the original session. The fix retains the original machine, requested path, resolved directory, worktree and agent definition and locks configuration controls after creation.

The failure case was exercised with the real local server, daemon and Codex. Playwright aborted exactly one `GET /v1/sessions/:id` request after the daemon created the session (network fault injection, not a mocked service response). The app displayed the failure and locked destination. An attempted path-control click could not open the picker. After restoring requests, retry completed the exact same session ID, returned the saved Markdown instruction marker, and the real server's session count increased by exactly one across the failed attempt and retry.

A second read-only Codex review found a P2 draft-loss issue: clearing the prompt after an asynchronous attachment upload could erase newer text entered during that upload. The app now clears only when the live draft still exactly matches the submitted text.

For the regression check, Playwright held the real attachment request open, entered a different draft while the upload was pending, then released the request to the real server. Codex responded with the submitted task marker and saved Markdown marker. Returning to the new-session screen and then the Codex agent launch restored the newer, unsent draft. No upload or model response was fabricated.

The complete app suite (878 tests) and typecheck passed after both fixes. The final read-only Codex review found no further actionable regressions in launch validation, snapshot persistence, retries or message configuration. The reviewer did not rerun tests; the executed checks above were run separately.

## Screenshots

Screenshots show only the isolated test account. Phone screenshots use a 390×844 Chromium viewport.

- [Codex-only runtime setup, phone](codex-runtime-mobile.png)
- [Fresh Codex-only launch, phone](codex-only-session-mobile.png)
- [Destination locked after network failure](retry-destination-locked-mobile.png)
- [Same session completed on retry](retry-completed-mobile.png)
- [Editing the draft during an attachment upload](upload-draft-during-mobile.png)
- [Newer unsent draft preserved after delivery](upload-draft-preserved-mobile.png)
- [Discover, desktop](discover-desktop.png)
- [Review configuration, phone](review-mobile.png)
- [Saved library, phone](library-mobile.png)
- [Real Codex response, phone](live-session-mobile.png)
- [Revised instructions and Markdown response, phone](revised-session-mobile.png)

## Checks

- App suite: 878 tests passed across 85 files, including the added snapshot, flag, model-validation and metadata-concurrency tests.
- App TypeScript check passed.
- Whitespace/diff check passed.
- Claude response validation: not passed; new Claude library launches are outside this Codex-only increment.
- Native simulator/device validation: not run; responsive web evidence only.
