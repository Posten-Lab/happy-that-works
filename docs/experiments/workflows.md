# Experimental consensus workflows

Enable **Settings → Features → Experimental Features → Workflows**. Open Workflows from Settings or the agent library. This feature requires a coordinator machine running the workflow-capable CLI; older daemons display “CLI update required.” No npm publication is part of this change.

Create at least five distinct saved Codex agents, then use the four-step workflow wizard to assign two to four planners, one executor, and two to four reviewers. Each slot has its own assignment. The first planner consolidates proposals but has no extra voting power. Save the workflow with acceptance criteria, at least one completion-check command, round/turn limits, and an optional user approval checkpoint after planner consensus.

Starting a run requires a task and an absolute path to the root of a clean Git project. The daemon creates a separate branch and worktree from the committed baseline. The original working directory is not modified. The run freezes the workflow and all agent definitions. Explicit participant replacement creates an audited change and restarts planning; editing a library definition never changes an existing run.

## Advancement rules

1. Planners independently propose approaches. Each proposal gets the task, criteria, assignment and user clarifications, but no other proposal. Participants currently execute sequentially; independent assessment does not imply parallel execution.
2. The plan owner consolidates the proposals. Every planner must explicitly approve the same plan version, without blocking findings. Missing information pauses the run. Disagreement creates a revised plan and a fresh vote from every planner, up to the configured limit.
3. An optional user checkpoint requires approval before execution. It cannot override a dissenting planner.
4. The executor works in a workspace-write Codex sandbox. Planners and reviewers use read-only sandboxes. Workflow clients disable inherited MCP servers, apps, plugins and agent delegation; approval escalation is denied. The configured model and effort are validated against the machine's live catalog without substitution.
5. User-configured completion commands run inside the worktree, with ordinary host command permissions. These are explicit executable configuration, not agent-generated commands. The UI explains this before save/start. Each command has a five-minute timeout and bounded captured output. A check that changes tracked/nonignored workspace files pauses for inspection.
6. Every reviewer independently inspects the same verified workspace contents, check outputs, executor report, and previous round's findings. Results contain a decision, supporting evidence, and actionable blocking/nonblocking findings. All reviewers reassess after a correction round.
7. Completion requires unanimous current approvals, every configured check passing, and unchanged workspace contents. The executor cannot clear reviewer findings. The controller verifies these gates; an agent's declaration of completion is insufficient.

Plan changes, unavailable models, malformed results, failed checks, disagreement limits, interrupted turns and changed workspace contents cannot silently pass a gate. Planning/review loops default to three rounds, and agent turns also have a configurable count and time limit. This is not a dollar-denominated spending cap or a guarantee of answer correctness.

## Run workspace and control

A run shows task, status, stage, plan/review rounds and agent-turn usage. The team lists every participant and links to its inspectable Talos session. Those sessions are workflow-managed: their composer is replaced with a link back to the run.

- **Plan:** criteria, consolidated plan and current planner votes.
- **Work:** preserved worktree/branch, workspace hash, executor summaries and actual check output.
- **Review:** current findings, evidence, required corrections and decisions.
- **Activity:** agent attempts and an ordered decision/event history. Full prompt and result details load separately to keep routine phone polling bounded.

Pause/cancel interrupts the active turn or check. Worktrees and evidence are retained. Resume after a failure requires an explanation/inspection confirmation. Clarifications reach new attempts rather than returning cached information requests. Replanning invalidates prior approvals; replacement agents must be distinct from the remaining team. Revision checks reject stale user actions from another device. Review retries cannot bypass agreed planning or execution.

There is no “force consensus” or silent finding waiver. After a configured limit, the user must revise the plan or start a new run with an appropriate budget. Automatic merge, PR creation, publication, deployment, arbitrary graphs, concurrent executors, dollar budgets, and verified browser/vision capability matching are not included in this increment. A completed run leaves its worktree and evidence ready for the project's delivery process.

## Durability and encryption

The trusted coordinator lives in the existing machine daemon and continues when the app closes. Runs are scoped to the server/account machine. Local records use authenticated encryption under the machine encryption key and atomic private file writes (file flush before rename, plus directory flush on Unix); workflow payloads travel through the existing end-to-end encrypted machine RPC transport. Reusable definitions use encrypted account settings. No workflow plaintext or new schema is added to the relay server.

Only the original coordinator machine owns a run; another device can reconnect through it. An offline machine cannot execute or serve its run. The app retains the last loaded view while open and reports unavailable state instead of claiming a live update.

A coordinator restart preserves completed tasks and pauses interrupted work for inspection. It never automatically repeats an execution with uncertain side effects. Shutdown awaits participant cleanup and pending starts for up to 15 seconds, then prevents late state writes from racing a replacement coordinator. Corrupt saved workflow state fails closed for workflows, retaining files for recovery. A pending start identifier survives app reloads without persisting its prompt. Idempotent start IDs and a start-status reconciliation action let the app distinguish an outstanding request from a definitively rejected one before unlocking its form.

The workspace hash covers tracked and untracked nonignored files and symlink targets, with a 20 MB per-file verification limit. Ignored files and external systems are outside that snapshot boundary. Repositories with Git submodules are rejected before starting and before verification. Agents are instructed not to launch untracked/background work, but a completed run is not an assertion that arbitrary external side effects were audited.

## Codex protocol

Structured decisions use `turn/start.outputSchema` and are independently parsed/validated by the coordinator. See [the official app-server contract](https://learn.chatgpt.com/docs/app-server). The app-server process uses the machine's installed Codex authentication; it does not introduce another provider or replace the user's configuration on disk.
