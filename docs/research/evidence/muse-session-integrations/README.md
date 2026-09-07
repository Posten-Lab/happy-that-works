# Muse session integration evidence

Validated with installed Muse Code 1.0.3, a real Meta account, Talos's local API and daemon, and Chromium against the development web app.

- `compact-tools-and-todos.png`: automatic chat title, a collapsed native `read_file` row, and the shared task panel at 1/3 with the next step in progress.
- `tool-details.png`: clicking the compact tool row opens the existing shared detail view with the full input and output.
- `renamed-and-completed.png`: an explicit rename request updates the sidebar and chat header; completing the native plan updates the task panel to 3/3.

The native provider acceptance test covers explicit title changes, restoring todos on resume, and clearing the task list. The PTY fixture `packages/talos-cli/tests/muse-e2e/session-integrations-fixture.ts` checks the same session through remote → native terminal → remote control, including title changes and todo completion after handoff.

Muse 1.0.3 filters environment variables from MCP child processes, so the bridge locates its launching Talos process through a private registry and checks the process start time. Ordinary Muse sessions receive no Talos MCP tools. Native terminal resume can drop MCP registrations; the installed Talos skill documents the CLI fallback to the same HTTP session tools. It does not create a second title or image service.

Validation commands:

```sh
pnpm --filter @ahmadposten/talos-wire test
pnpm --filter talosapp test
pnpm --filter talos-app exec vitest run
pnpm --filter talosapp exec vitest run --project integration-muse -t 'uses Talos session tools'
# Run with a real terminal, from packages/talos-cli:
MUSE_TEST_AUTO=1 pnpm exec tsx tests/muse-e2e/session-integrations-fixture.ts
pnpm verify:brand
pnpm verify:packaged --cli-only
```

Cancelled native todos are omitted from the actionable shared list. Empty native todo snapshots clear the panel. Revisions are not used as ordering guards because Muse resets them after resume.
