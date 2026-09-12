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

## Screenshots

Screenshots show only the isolated test account. Phone screenshots use a 390×844 Chromium viewport.

- [Codex-only runtime setup, phone](codex-runtime-mobile.png)
- [Fresh Codex-only launch, phone](codex-only-session-mobile.png)
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
