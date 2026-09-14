# Planner visibility and CLI 1.0.18

PR #58 adds planner navigation, source transcripts, plan comparisons, round-specific votes, and objection response history. Wire 0.1.7 carries recorded participants, task inputs, and finding responses. CLI 1.0.18 records these fields for new runs and requests structured responses from workflow providers. Existing persisted runs remain readable.

Preparation includes wire prepublish (48 tests), complete CLI prepublish (1,094 tests), app typechecking, and brand verification. The feature's complete app suite (987 tests), real three-planner workflow, browser navigation checks, and screenshots are recorded in [the evidence directory](../evidence/workflow-planner-visibility/README.md). Release validation also checks actual installed candidate packages before publication and registry-backed packages afterward.

Publish wire first with `pnpm release wire --publish`, verify the registry wire dependency, then publish CLI with `pnpm release cli --publish`. Deploy the app through the existing guarded production Jenkins jobs. Mobile delivery uses the production runtime compatibility gate. Update workflow machines to CLI 1.0.18 for complete history on new runs.

Final registry versions, deployment commits, and verification receipts belong in PR #58. This release does not change database schema, encryption secrets, or store identity.
