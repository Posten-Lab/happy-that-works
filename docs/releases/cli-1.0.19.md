# Muse startup and CLI 1.0.19

Includes the Muse startup fix merged in [PR #61](https://github.com/Posten-Lab/happy-that-works/pull/61).
Some Muse builds report `plugins are not available in this build`; Talos now
starts the native session and uses its existing terminal bridge for title and
image tools. Plugin-capable builds retain the native plugin path.

This CLI-only release follows 1.0.18 and uses the already published wire 0.1.7.
It does not require a web, server, or native-app deployment. Existing failed chats
without a native Muse session ID still need a fresh start.

Preparation passed wire prepublication checks (48 tests), the complete CLI
prepublication chain (1,100 tests), and brand verification. The server/agent and
production web bundle were built for package verification. The first package
verification attempt exhausted local disk space; task-owned generated files were
cleaned before rerunning the unchanged verifier. The full rerun passed all five
installation layouts, including the live relay, database authentication, and
bundled web app. Completed temporary installations were reclaimed between
scenarios to limit disk use. Packed metadata confirmed `talosapp@1.0.19`,
wire `0.1.7`, MIT licensing, and no private state or unpacked tool caches.

The release candidate passed the real Muse/relay harness on the Mac:

```sh
TALOS_DAEMON_CHILD=1 TALOS_E2E_CLI_ROOT="$PWD/packages/talos-cli" \
  node docs/research/evidence/muse-pluginless-startup/e2e.mjs
```

This flag retains the existing daemon during candidate validation. The test
persisted the native session ID, received a model reply, changed the title through
the real session tool, and resumed the same native ID with retained conversation
context. Its two test chats were removed. The original Linux reproduction and
validation are recorded in the [fix evidence](../research/evidence/muse-pluginless-startup/README.md).

Publish through `pnpm release cli --publish`, verify registry metadata and a fresh
registry installation, then activate the Mac CLI and daemon while preserving the
existing account and running chat processes. Final package, installation and
continuity receipts belong in the release PR.
