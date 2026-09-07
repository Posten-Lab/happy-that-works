# Muse controls acceptance — 2026-09-07

Native Muse: 1.0.3-R2198.1; SDK: 0.1.1. Real authenticated Meta inference.

- All eight requested effort choices passed inference and repeated durable resume on the fixed Contributor model. `max` was separately verified to send `xhigh` in the native CLI request body. The native terminal reports its ultra gate closed and falls back to xhigh; MSP accepts ultra. The selector explains both cases.
- All five approval choices were checked against native `session/read` projections. YOLO wrote the requested test file without prompting; never-prompt denied the write without prompting. YOLO host restarts retained the native UUID, and control settings survived a new adapter instance.
- A real PTY restored populated native history with `--yolo --reasoning-effort ultra`, returned to Talos, and produced `violet-heron` in the same conversation. Native session: `01a07d7d-2bc6-75c1-9928-a556463618b7`. Result: `TALOS_SAME_SESSION_HANDOFF_PASSED`, exit 0.
- That test exposed missing native live notifications after terminal handoff. A separate MSP observer now recovers real terminal events and pending approvals; synthetic incomplete folds during live execution do not terminate a turn. The regression test checks incomplete followed by real completion.
- Browser testing used an isolated authenticated environment and the real local daemon. Agent Defaults showed every effort and approval option. Saved YOLO/ultra settings carried into a new Muse session, which answered `TALOS_MUSE_CONTROLS_OK`. Changing effort to max in the active session answered `MAX_EFFORT_OK` and persisted `effort: max` alongside `permissionMode: yolo` in its native-session control file.
- Full app suite: 771 tests passed. All five live Muse integration tests passed, including model-change rejection, approvals, cancellation, efforts, and resume. Final CLI/packaging results are recorded in the release receipt.

## Screenshots

- [Effort options in Agent Defaults](effort-selector.png)
- [Approval options in Agent Defaults](approval-selector.png)
- [Active Muse session controls](active-session-controls.png)

The screenshots contain only the isolated test account and test conversation.
