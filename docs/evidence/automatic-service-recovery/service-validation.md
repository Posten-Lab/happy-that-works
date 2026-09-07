# Background service and recovery validation

All service tests used separate Talos homes and a disposable account on the
actual local relay. The macOS service used a dedicated LaunchAgent; Linux tests
used disposable systemd and OpenRC containers on an authorized development host.
The host's existing services were preserved. Actual authenticated Claude and
Codex CLIs supplied provider responses.

## Service installation and startup

- A real macOS LaunchAgent started before account pairing, waited quietly, and
  connected after credentials were supplied without starting a terminal coding
  session. The separate unpaired test service was then uninstalled.
- Actual npm global package installs registered systemd and OpenRC services.
  systemd enabled lingering automatically, including when installation had no
  PAM login or `XDG_RUNTIME_DIR`. OpenRC joined the default runlevel and ran the
  daemon as the ordinary test user under `supervise-daemon`.
- An already-connected `talos auth login` completed startup without opening a
  coding session. The browser used the encrypted machine RPC to create sessions.
- Package upgrade and daemon-only SIGKILL checks required existing provider
  processes to retain their PIDs, with exactly one process per conversation.

## Recovery and user intent

The Linux harness restarted the complete container process namespace and its
real service manager. The daemon started without an interactive login, then
restored the same Talos conversation IDs and native provider thread IDs. New
prompts were sent as soon as restored processes appeared, and tests required new
provider replies containing unique nonces. Separate context checks asked each
provider to recall its first pre-restart marker without supplying that marker in
the question.

macOS checks killed only the isolated daemon and its selected coding session.
launchd restarted the daemon, and recovery restored the same provider
conversation. Both the UI and direct relay client exercised the result.

Additional real-service/browser checks covered:

- Archive while the daemon was paused and the coding process was unavailable;
  encrypted archive intent reached the server and prevented later recovery.
- A temporarily renamed project directory exhausted bounded retries, exposed a
  useful error, then allowed Resume from the original conversation after repair.
- Switching automatic restoration off and on persisted the setting.
- Explicit stop-session RPC followed by a service-manager restart kept sessions
  stopped across repeated recovery scans.
- Session metadata preserved model, permission mode, native thread identifiers,
  and fields unknown to the current app during offline archive and reconnect.
- A live unrelated process was placed in deliberately stale daemon state and
  lock records with a different saved birth identity. Startup reclaimed those
  records without signalling the unrelated process.
- A dedicated TCP proxy disconnected one daemon from the relay during explicit
  shutdown. The forced shutdown timeout was exercised, and the persisted pause
  prevented its supervisor from reconnecting it.
- Real launchd replacement returned transient bootstrap errors while its old
  service unloaded. Bounded retries completed replacement and retained the
  existing coding process.

The [browser captures](README.md) show the actual setting, recovery, failure and
manual retry flows. The machine-readable [macOS results](macos-service-validation.json),
[Linux results](linux-service-validation.json), and
[unavailable-relay shutdown results](offline-daemon-stop-validation.json) record
the immutable package hash, exact checks, session identifiers and cleanup outcomes.

## Reproduction and scope

The Linux harness, container definitions and commands are in
[`packages/talos-cli/tests/service-e2e/linux-README.md`](../../../packages/talos-cli/tests/service-e2e/linux-README.md).
The test account's tokens, encryption keys, authentication URLs and provider
credentials were supplied privately and are excluded from evidence.

The macOS packed-CLI checks ran `node <packed-package>/bin/talos.mjs auth login`
and `node <packed-package>/bin/talos.mjs daemon restart` with only the disposable
`TALOS_HOME_DIR` and relay URLs selected. The relay client used
`spawn-happy-session`, `stop-session`, and ordinary encrypted user messages.
The crash test sent SIGSTOP to its isolated daemon, SIGKILL to its selected coding
process, then SIGKILL to that daemon; `/list` polls checked the replacement PIDs.
The unavailable-relay test closed a dedicated TCP proxy and used `POST /stop`
on the test daemon's local control port. Uninstall and opt-out were verified
through the same shipped service adapter used by CLI installation.

The Linux boot test restarts container init and every process in its namespace;
it does **not** reboot the host kernel or change its boot ID. The Mac was not
physically rebooted or logged out. Unit regressions cover stale locks and PID
reuse across a changed boot identity. Native provider recovery was exercised
end to end for Claude and Codex; Muse uses its existing native resume adapter
with regression coverage. Providers lacking a native resume adapter remain
available for new sessions but are not automatically resumed.

Windows retains its existing detached-daemon controls through a process creation
time adapter with regression coverage; no Windows service or Windows E2E is
included in this macOS/Linux change.

Restoration reconnects saved conversations. It does not replay interrupted shell
commands or automatically repeat a tool operation whose outcome is unknown.
