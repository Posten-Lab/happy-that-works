# Muse startup without plugin support

Validated September 14, 2026 on the affected Dell Linux host and on macOS.

## Reproduction

The Dell runs Muse Code `1.2.1 (1.2.1-R2847.1)` and Talos CLI `1.0.16`.
Running `muse plugins list --json` exits unsuccessfully with:

```text
plugins are not available in this build
```

The reported saved-agent session created its Talos record, then exited during
`ensureMuseSessionPlugin()`, before the Muse host started. Its recovery checkpoint
had no `museSessionId`. Automatic restore subsequently reported the missing ID.

## Fix

Treat that specific native capability diagnostic as plugin unavailability.
Continue starting the durable Muse session and register the existing terminal
bridge. Supply instructions for the terminal title/image tools, including on
resume. Unexpected plugin failures still propagate. Builds with plugins retain
their installation, enablement and approval flow.

Existing failed chats with no native ID are not automatically repaired by this
change. The fixed CLI supports newly started sessions and native resume.

## Automated checks

From `packages/talos-cli`:

```sh
pnpm exec vitest run --project unit src/muse/museSessionBridge.test.ts src/muse/MuseSession.test.ts src/agent/runManagedProvider.test.ts src/commands/museCommand.test.ts src/resume/handleResumeCommand.test.ts
pnpm exec vitest run --project integration-muse src/muse/muse.integration.test.ts -t 'uses Talos session tools'
```

- Focused unit checks: **52 passed in five files**. Test setup also built and
  typechecked the CLI against the freshly built workspace wire package.
- macOS real Muse integration: **one selected test passed** (three unrelated
  tests skipped by the filter). Verified native plugin title calls, todo updates,
  resume, and clearing restored todos. Real Muse and MCP tools; the test captures
  Talos callbacks locally rather than using the relay.

## Dell end-to-end evidence

Staged this branch's built CLI (`bin`, `dist`, `scripts`, `package.json`) in a
temporary directory, with a matching built `talos-wire` package. Reused the
installed Linux dependencies through temporary symlinks. The installed CLI and
daemon were not replaced. Initial staging attempts failed before Muse startup
because the installed wire package lacked a current-main export and the first
bundle omitted the CLI scripts; both staging omissions were corrected.

Run the included [harness](e2e.mjs) on that host, with the built package and its
dependencies accessible:

```sh
TALOS_E2E_CLI_ROOT=/tmp/talos-muse-startup.H2zNg7 node /tmp/talos-muse-startup.H2zNg7/e2e.mjs
```

Uses the installed authenticated Muse process, the actual Talos CLI, encrypted
messages through the live Talos relay, and the real title tool. No provider,
protocol or relay mocks. It creates two test chats and deletes only those chats
after stopping their processes. Muse's durable local test history remains.

Observed output (exit status **0**):

```jsonl
{"event":"started","sessionId":"cmu1stqfi00qhmr011329f4ck","nativeSessionId":"01a0a1fa-cd98-7143-8467-cbc4802efa01"}
{"event":"reply","text":"copper-otter-725"}
{"event":"terminal-title-tool","result":"passed"}
{"event":"resumed","sessionId":"cmu1su5m900r1mr01hvuoc9gb","nativeSessionId":"01a0a1fa-cd98-7143-8467-cbc4802efa01"}
{"event":"reply","text":"copper-otter-725"}
{"event":"result","result":"passed"}
```

The harness asserts that the native session ID is persisted on the relay, the
terminal fallback changes the title to `Muse Pluginless E2E`, and native resume
retains the same ID and recalls the code word from the previous process.
Image upload and native-terminal handoff were not exercised by this check.
