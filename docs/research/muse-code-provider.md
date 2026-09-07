# Muse Code provider integration

Investigated 2026-09-07 against Talos main `de74b733`.

## Implementation status

The draft implementation uses Meta's pinned `@muse-code/sdk@0.1.1` with the
installed Muse CLI `1.0.3-R2198.1`. `MuseSession` owns the native MSP host and
terminal process; `runManagedProvider` owns Talos encrypted transport, permissions,
message queue, daemon registration, heartbeat and shutdown. Messages use the
existing active `sendAgentMessage` format; the frozen session protocol is untouched.

**Not ready to merge:** login and live model discovery work, but Meta rejects
model inference with HTTP 402 `Billing verification failed`. The real acceptance
suite fails on its first model response. No successful conversation, real edit,
or approval round trip is claimed. See [validation evidence](evidence/muse/README.md).

## Architectural consistency requirement

Muse must use the existing Talos provider architecture: an adapter controls the
provider's own harness and connects it to Talos sessions, encrypted transport,
permissions, and UI. Do not introduce a separate Muse product flow, relay, agent
execution loop, or parallel session store. Persist its native session reference
through the established provider metadata and resume mechanisms.

Current provider connections are already heterogeneous:

| Provider | Connection implemented in Talos |
| --- | --- |
| Claude Code | Official agent SDK wrapper in `src/claude/sdk/query.ts`, plus local terminal handling |
| Codex | Native `codex app-server` client in `src/codex/codexAppServerClient.ts` |
| Gemini | Native CLI ACP mode through `src/agent/factories/gemini.ts` |
| Generic ACP agents | Shared `src/agent/acp/runAcp.ts` runner |
| OpenClaw | Gateway WebSocket adapter in `src/openclaw/runOpenClaw.ts` |

Thus a Muse native-protocol adapter follows the Codex pattern; Talos does not
currently mandate ACP for every provider. Keep Muse-specific logic limited to
launch, protocol translation, and native capabilities. Reuse shared behavior
where it exists, and avoid copying entire provider runners. Existing runners
still differ in event representation, so this recommendation is not a claim that
all providers already share one implementation. Any necessary common behavior
should be added to the shared layer rather than hidden inside Muse-only code.

## Current Muse interfaces

Muse Code itself is out of beta, as confirmed by Meta's
[release announcement listing](https://developers.meta.com/resources/blog/).
It has its own CLI and agent harness. Talos would launch that existing harness
through `muse serve` and expose its sessions remotely; the SDK is the client
interface for controlling the harness. The preview qualification below applies
specifically to the SDK, not to the Muse Code product.

Meta publishes a TypeScript SDK for MSP, requiring Node 20+. It is a pre-1.0
Developer Preview without an API stability guarantee. Pin the SDK version and
validate against a specific Muse host release before advertising support.
Source: [official SDK repository](https://github.com/meta-models/muse-code-sdk).

The official quickstart starts `muse serve`, initializes the connection, starts a
session, and submits turns. Notifications carry streaming items and turn completion.
Approval decisions and cancellation are explicit commands. Cancellation requires
waiting for the terminal notification. A configured Muse login is required; some
host builds can disable the SDK tier and exit with code 5. Register the notification
handler before starting sessions to avoid dropping early events.
Source: [official quickstart](https://meta-models.github.io/muse-code-sdk/guides/quickstart/).

Two community ACP adapters illustrate different tradeoffs:

| Route | Fit for Talos |
| --- | --- |
| [BrokkAi/muse-acp](https://github.com/BrokkAi/muse-acp) | Stateful MSP bridge with approvals, models, cancellation, and resume. Candidate for a quick ACP trial. Currently ignores client-supplied MCP servers, so Talos's injected tool bridge would need separate handling. |
| [bex-co/muse-code-acp](https://github.com/bex-co/muse-code-acp) | Wraps `muse exec --json` per turn. Its documented Muse 0.2.1 limitations include no interactive approvals. Its claim that no SDK/server exists is superseded by Meta's current SDK. |

Candidate smoke command after separately installing/authenticating Muse and the
Brokk bridge: `talos acp -- muse-acp`. This is inferred from Talos's generic ACP
command resolver, not a verified working command pairing.

## Changes required in Talos

1. **Launch and availability.** Add `talos muse` routing in
   `packages/talos-cli/src/index.ts`, a `src/muse/runMuse.ts` runner, and executable
   detection in `src/utils/detectCLI.ts`. Extend machine availability types and
   change detection in `src/api/apiMachine.ts`, plus daemon spawning.
2. **Provider identity.** Add `muse` to relevant agent and spawn types, session
   metadata, app selectors, and `packages/talos-app/sources/sync/agentDefaults.ts`.
   That file currently recognizes Claude, Codex, Gemini, and OpenClaw; unknown
   flavors fall back to Claude. Merely launching a generic ACP command is therefore
insufficient for a correctly labeled provider with independent defaults.
3. **Event mapping.** Map MSP turns, streamed messages, tools, and completion into
   `packages/talos-wire/src/sessionProtocol.ts`. Preserve native session/item/turn
   identifiers alongside Talos IDs. Distinguish accepted commands from completed
   turns, and account for revised items so final snapshots do not duplicate deltas.
4. **Permissions and questions.** Adapt Muse's advertised approval choices and
   requirement identifiers to Talos's pending-request UI. Reuse permission transport
   patterns from `src/utils/BasePermissionHandler.ts`; reject stale choices and
   clear pending prompts on process exit. Design the user-input question bridge
   explicitly rather than silently choosing answers.
5. **Models and effort.** Query Muse's live catalog and wire supported settings into
   the existing pickers. Avoid copying another provider's defaults or hard-coding
   a Muse model version. The current ACP runner only resolves mode/model selectors;
   arbitrary config selectors need additional work even with the bridge route.
6. **Resume and recovery.** Persist a Muse session ID in encrypted metadata and
   extend `src/resume/` plus daemon resume routing. Respect the host's durability
   and ownership rules; replay must not resend an already accepted user command.
7. **Tools and attachments.** Verify how Talos's MCP tools can reach native Muse;
   the generic ACP runner injects a stdio MCP server today. Verify image input,
   tool results, subagent rendering, and usage reporting independently before
   enabling those capabilities in the app.

The existing relay and session-envelope transport appear reusable. No new relay
architecture is indicated by this investigation; provider-specific schemas and
metadata still need an implementation-time audit.

## Validation gate

### Native CLI exposure and handoff requirement

The intended feature includes using the real Muse terminal interface and continuing
the same durable session through Talos. An SDK-backed remote runner by itself does
not provide the native terminal UI or establish that handoff works.

Talos already has explicit local/remote switching for Claude in
`src/claude/loop.ts`. Codex's current runner uses its app-server and a Talos terminal
display. Native terminal switching is therefore not automatic across providers.
Muse should reuse the established control-mode and resume concepts while supplying
its provider-specific native launch and session-discovery behavior.

Implemented commands:

- `talos muse`: launch the real Muse CLI locally under Talos supervision, with a
  path to continue the same session from the app.
- `talos muse --resume <muse-session-id>`: adopt a durable session previously
  started with plain `muse`, once its current owner has released it.
- Return to the native CLI using the same session after the Talos-owned host
  releases it. The verified native command is `muse resume <id> --workspace <cwd>`.

The [MSP process model](https://meta-models.github.io/muse-code-sdk/guides/msp-concepts/sessions-and-turns/)
documents one writer lease per loaded session, one client connection per v1 host,
and stdio transport tied to the spawning process. A competing host receives
`sessionInUse`. Consequently the documented SDK does not establish live attachment
to an arbitrary already-running terminal process. Design an orderly ownership
transfer, not concurrent writers. Closing an MSP host cancels its active run; the
handoff UI must not imply that an in-flight run migrates uninterrupted.

The [resume method](https://meta-models.github.io/muse-code-sdk/generated/msp/methods/session-resume/)
loads a stored session and subscribes the new connection. A direct real-PTY test
passed MSP → native terminal → MSP transfer with the same session ID. Native
permissions and history during an actual model-backed task remain acceptance gates.
Ephemeral sessions are rejected because they cannot provide durable resume.

### Required checks

Use captured/fake MSP transcripts for event revision, stale approval, duplicate
command acknowledgement, cancellation races, process death, and resume replay
tests. Then perform a real authenticated session from both CLI and mobile: stream
text, inspect/edit a fixture, approve and deny a tool, cancel a running command,
send another turn, restart and resume, and change an advertised model. Verify
MCP tool access separately. Do not label the provider fully supported before these
flows pass on the chosen host/SDK pair.

## Checkout correction

The Talos rebrand already merged via PR #12, merge `482b4113`, including rebrand
commit `71fde82d`. The supplied session checkout was at `9ef11ade`, 60 commits
behind fetched main. Existing uncommitted work was left intact. This investigation
uses a fresh Talos worktree from current main.

`node scripts/verify-brand.cjs` passes: seven workspaces, 29 supplied assets, and
all checked product source directories. This is a scoped brand check, not a claim
that historical text contains no legacy strings. Compatibility constants,
encryption domains, upgrade identities, and required attribution were retained by
the prior migration deliberately; changing encryption contexts would make existing
encrypted data unreadable. A second bulk rename is not needed to complete the
product rebrand.


## Usage and current limits

Install the official CLI from https://dev.meta.ai/ and authenticate with `muse login`.
Talos uses the installed CLI's credentials; it does not introduce a second Muse login.

```sh
talos muse
talos muse --resume <native-muse-session-uuid>
talos muse -- --model muse-spark-1.3
talos muse --talos-starting-mode remote
talos resume <talos-session-id>
```

Native flags after `--` apply when the native terminal launches. Persistence and
workspace-changing flags are rejected: launch Talos from the desired workspace.
For a session started with plain `muse`, exit that CLI before adopting it through
`talos muse --resume`. An active native turn is interrupted when remote control
closes its terminal; control transfer preserves the session, not uninterrupted execution.
Remote → terminal switching requires the original Talos process to have a TTY and
no active remote turn. Daemon-started sessions cannot grow a terminal remotely.

Muse appears in the existing provider picker, agent defaults, live model picker,
permission modes and resume actions. It maps only advertised approval choices,
including changed approval stages, and exposes Muse user questions through Talos's
existing question tool. A small local journal contains only submitted command IDs
so restarting the same Talos session does not duplicate its prompts in imported
Muse history. Native session content remains owned by Muse.

Current limits requiring follow-up before declaring full support:

- Text messages are emitted from authoritative completed items; live token deltas
  are not rendered. Tool starts/results and activity events are forwarded.
- App attachments are explicitly rejected with the existing attachment-status event.
  Native workspace file access remains Muse's own behavior.
- Talos-specific MCP tools are not injected. Existing native Muse configuration is
  inherited; dynamic MCP/tool registration needs separate verification.
- Full model-backed acceptance, question/approval UI exercise, populated-history
  handoff and restart recovery remain blocked by the Meta account billing failure.
