# Agent YOLO and Markdown reference validation — 2026-09-14

Base: `eb890d3b` (`origin/main`). Isolated environment: `keen-crater`.

Real services: PGlite Talos API on localhost:55213, Expo web on localhost:55214, a built CLI daemon with its own environment home, and installed Codex using GPT-5.6-Sol with low effort. No API, model catalog, or model responses were mocked. The daemon was started with inherited Talos/Happy/Codex/Claude session variables removed and only the isolated home/server/web settings supplied. Authentication stayed in ignored environment files.

Browser: agent-browser 0.21.0, with Playwright connected over CDP for native file chooser handling, assertions and screenshots. Phone viewport 390×844; desktop viewport 1280×900. The latest agent-browser package required a newer pnpm than the environment provides, so validation used 0.21.0.

## Observed behavior

1. Created an agent through the library wizard. Imported an actual 21,351-character `reference.md` with a marker at the end, beyond the former 16,000-character limit. The UI showed the filename, character count, and “added to draft” confirmation.
2. Selected an actual 64,001-character Markdown file. The UI displayed “too-large.md not attached” beside the attachment button and explained the 64,000-character limit. Only the successful reference appeared in the draft and review.
3. Selected YOLO, saved, reloaded the browser, and reopened the agent. Both YOLO and all 21,351 reference characters persisted. Editing and saving also retained them.
4. Started a real session from the saved agent through the new-session UI. Without approving any permission prompt, Codex ran a shell command that wrote `YOLO_AGENT_OK` to `agent-yolo-proof.txt` in the isolated project and read it back. The file's actual contents were checked from the host. Its response also included `MARKDOWN_OVER_16K_OK`, the marker at the end of the reference. The session displayed YOLO.
5. Switched the draft between Claude, Muse Code, and Codex using live model discovery. YOLO remained selected for each provider. Real provider execution was validated with Codex; Claude/Muse execution was not rerun.
6. Delayed the real browser `File.text()` call with a controllable gate. While it was pending, Continue and Attach were disabled. Edited the instructions and removed the previously attached file, then released the read. The newer instructions and removal survived; the completed import added exactly one reference.
7. Injected a browser file-read exception. The UI displayed “reference.md not attached. Test read failure” and preserved the prior reference. This was an intentional local read-failure test; it did not replace any service response.
8. Added the saved agent to a workflow executor stage, reopened its configuration, and confirmed YOLO plus the full 21,351-character reference. Saved the edited workflow participant successfully. The editor explains that the saved permission preference applies to direct sessions; workflow stages retain their own tool/workspace restrictions. A full workflow run was not performed.

## Commands and checks

```sh
pnpm install --frozen-lockfile
pnpm env:up --template authenticated-empty --no-switch
pnpm --filter @ahmadposten/talos-wire build
pnpm --filter talos-app exec vitest run
pnpm --filter talos-app typecheck
pnpm --filter @ahmadposten/talos-wire exec vitest run
pnpm --filter talosapp exec vitest run --project unit src/workflows
git diff --check
```

- App: 978 tests passed in 99 files; TypeScript passed. Rerun after the final review wording change.
- Wire: 34 tests passed in 4 files; build/typecheck passed.
- CLI workflow regressions: 67 tests passed in 7 files; the test setup rebuilt/typechecked the CLI.
- New regression coverage includes all three providers' saved YOLO settings and session metadata precedence, documents beyond 16K, the exact 64K boundary, multibyte content, invalid filenames, oversize pre-read rejection, and read failures.
- Native iOS/Android simulator execution was not performed; UI evidence is responsive Chromium.
- Library and workflow aggregate transport budgets remain enforced. Existing workflow daemons need the updated wire schema to accept YOLO snapshots or references beyond the old limit; this PR does not publish a CLI release.

## Screenshots

- [Successful Markdown import, phone](attachment-added-mobile.png)
- [Explicit oversized-file rejection, phone](attachment-rejected-mobile.png)
- [YOLO runtime selection, phone](runtime-yolo-mobile.png)
- [YOLO runtime selection, desktop](runtime-yolo-desktop.png)
- [Review with saved permission choice, phone](review-yolo-mobile.png)
- [Real session proof and reference marker, phone](session-proof-mobile.png)
- [Workflow participant permission setting, phone](workflow-agent-mobile.png)
