# Editable experimental workflows

Workflow creation opens an editable sequence, initially Planning → Build → Review. Add or reorder up to eight steps, give each a name and criteria, and assign one to three planners/reviewers or exactly one executor. Add an agent from the library or create one inline with its model, reasoning effort, instructions, and Markdown references. Candidate agents and the workflow save together; cancelling leaves the library unchanged. Editing a library agent makes a separate copy, preserving other workflows and sessions.

Execution stays serial within the isolated worktree. Every planner votes on the exact consolidated plan. Every reviewer must approve its gate's verified artifact; no majority overrides. Intermediate review checks belong to that step. The final review also runs all workflow completion checks. Failed review/checks rerun the preceding executor and all intervening gates, bounded by that review step's round budget and the run's total turn budget. A later execution intentionally creates a new artifact: earlier reviews are intermediate approvals, and final reviewers assess the final artifact. Planners/reviewers always run read-only; executors have workspace edit permissions.

```txt
WorkflowBuilder
├── withSteps(draft, steps) → WorkflowDefinition
│   ├── steps[] { id, name, kind, agents[], criteria, checks[] }
│   └── workflowProjection(steps) → legacy role summaries (derived, validated)
├── workflowSave() → validates workflow + agent libraries before any write
│   └── workflowLibrarySettings() → workflowLibrary / workflowLibraryV2
│       └── sync.applySettings() → one encrypted account settings update
└── Start workflow → workflow-start-v2 RPC
    └── WorkflowCoordinator.start()
        ├── runtime.validate(workflowSlots) → machine's live Codex model/effort catalog
        ├── runtime.prepare() → isolated Git worktree
        ├── WorkflowStore.save() → encrypted atomic v2/<run-id>.bin
        └── driveSteps()
            ├── plan → propose[] → consolidate → plan_vote[] → optional user approval
            ├── execute → approved plan required → one writer
            └── review → step checks (+ final completion checks) → artifact hash → votes[]
                ├── unanimous, checks pass, hash unchanged → advanceStep()
                ├── corrections, budget remains → preceding executor + downstream gates
                └── information / changed files / exhausted budget → needs_input
```

Tasks carry `stepId` and `attempt`; cached results cannot cross stage boundaries, retries, plan versions, or workspace revisions. Run state records the current step, completed steps, and per-review-step round counts. Cancellation and shutdown abort work without advancing. Restart preserves interrupted work and requires an explicit user decision before resuming. Definitions are frozen per run; changing the library does not change an existing run.

## Compatibility and rollout

- Existing three-stage definitions and saved runs retain their old runner and behavior.
- Editable definitions use `workflowLibraryV2`. Older apps preserve unknown settings fields but never parse these definitions as three-stage workflows. Editing a legacy definition moves it to the new field in the same settings update.
- Custom run state uses a `v2` subdirectory. Older CLIs ignore it on downgrade instead of replaying it as a legacy run.
- Version 2 list/get/task/action RPCs expose custom runs. Legacy RPCs show only legacy runs and refuse custom run details/actions. New starts use `workflow-start-v2`; there is no fallback to the old start method.
- The daemon advertises workflow capability 2 after registering its handlers, refreshing an existing machine's persisted metadata on connection/reconnection while preserving its identity and other metadata.
- Keep the existing Experimental Features + Workflows gates. There is no native dependency or icon change in this feature; normal web/mobile OTA deployment applies.
- Release wire and CLI through their normal PR-based npm release procedure, update/restart coordinator daemons, verify capability 2, then deploy web/mobile. Until a machine supports capability 2, the app allows design/save but blocks custom runs with an explicit update message. Preserve production sessions during CLI handoff using the established continuity procedure.
- This feature does not merge, publish, or deploy the user's workflow output. Those remain explicit user actions.

## Evidence

See [validation record](../evidence/workflow-builder/README.md) for actual browser/iOS interactions, real Codex execution, regression suites, and limitations.
