# Agent YOLO, references, and CLI 1.0.16

PR #57 adds saved YOLO permissions for direct agent sessions and explicit Markdown import feedback. Reference files may contain up to 64,000 characters. Wire 0.1.5 carries these definitions; CLI 1.0.16 lets workflow daemons read the updated agent snapshots. Workflow stage execution restrictions remain unchanged.

Preparation passed: wire prepublish (34 tests), complete CLI prepublish (1,087 tests), app suite (978 tests) and typecheck, brand verification, and real packed CLI installation checks in both isolated and hoisted layouts. The candidate tarballs resolve wire 0.1.5. Package checks exercise actual installed versions, diagnostics, native tools, and launcher searches. The agent feature's real Codex/browser/service validation and screenshots are in [the evidence record](../evidence/agent-yolo/README.md); the [in-app release notes](../evidence/agent-yolo/release-changelog-mobile.png) were also exercised in phone-sized Chromium.

Publish wire then CLI through `pnpm release wire --publish` and `pnpm release cli --publish`. Verify registry artifacts and installed versions. Coordinate Jenkins deployment after publication so workflow-capable machines can accept new snapshots before clients save them. Preserve immutable prior CLI runtimes, account data, session processes, and Jenkins rollback receipts. Web/API rollout uses guarded Jenkins jobs; mobile uses the production OTA compatibility gate.

Final publication and deployment receipts belong in the PR. No database, encryption-secret, DNS, or store-identity change is part of this release.
