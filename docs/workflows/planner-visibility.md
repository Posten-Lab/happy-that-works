# Planner visibility and workflow discussion

A workflow's Team view keeps all participants available while one runs. Select a step to inspect its team, then a participant to see their contributions across rounds and attempts. Historical participants remain available after replacement; voting columns use the roster saved with that task rather than silently substituting the current library definition.

The Team view has three views:

- **Discussion:** chronological proposals, coordinator handoffs, revisions, and assessments. Filter by participant and round or show unresolved objections. New updates are announced without moving the reader; the explicit update action jumps to the latest content.
- **Plan:** recorded consolidation results, including earlier versions. Open a revision to compare it with the preceding plan in the same step/attempt.
- **Decisions:** votes grouped by exact step, attempt, round, and version. New plans have pending votes. Interrupted attempts supersede earlier votes; approval with blocking findings never renders as clean agreement. Objections retain their complete recorded response history.

Contribution details open as a phone screen or desktop drawer. The fixed participant switcher jumps between evidence in the same round. Source links form a back stack, while **Open full transcript** opens the original task session. Transcript context supports direct participant switching and returning to all contributions by that participant. The discussion stays in place when returning from a session.

## Data and trust

`WorkflowTask.inputs` records the task IDs and exact content categories used when building its prompt. The prompt is constructed from these same references; the UI does not infer messages that were never sent. Categories are result, findings, summary, and plan. The complete original prompt remains available, including user clarifications and completion evidence. Independent proposal tasks have an explicitly empty input list.

A finding's identity is its immutable task ID plus its position in that task's findings. `findingResponses` contains the referenced finding ID, an explicit state (open, addressed, verified), and evidence. New provider output schemas request this array; persisted older results remain valid without it.

The coordinator accepts a response only when the task received the source finding and the scope matches. Consolidation/execution can record addressed. Only the original assessor can verify it during a clean assessment; a proposal objection can be verified in that planner's later plan vote. A later plan-owner statement cannot undo an assessor's verification. Explicit reopening is retained. Missing or unrelated approval never implies that an objection was resolved. These records explain decisions; the existing coordinator gates remain authoritative.

New runs carry `historyVersion: 1`. Optional fields preserve compatibility with older stored runs. Older runs show their available task/session evidence and explicitly identify missing handoff metadata. Unknown resolutions are not fabricated. Full evidence is loaded through the existing encrypted task RPC; routine run summaries retain shortened planning findings, rather than removing objections entirely.

The app and coordinator CLI must both include this change to record new handoffs and explicit response evidence. No server database migration or release is performed by this PR.

## Validation

See [real workflow evidence](../evidence/workflow-planner-visibility/README.md). The isolated browser test launches three actual Codex planners, deliberately introduces a missing check into plan v1, obtains a revised plan and explicit verification, exercises source transcripts and plan comparison, and approves execution through the UI. No mock agent outputs or injected workflow status are used.
