# Workflow workspace folders

Validated on 14 September 2026 with the isolated `jolly-mountain` API, web app, account and daemon. The browser launched each workflow through Talos's encrypted machine RPC, and the planner, executor and reviewer used the installed Codex provider. No provider turn, workflow RPC or completion check was mocked. Production services, settings and daemons were not used.

## Results

The direct-folder run `e0f53c3d-5624-42ce-af5e-5aa77004c6f6` selected a disposable non-Git parent containing a committed nested Git repository. The completed run kept `sourceDirectory` and `directory` at the exact selected parent, created no `.git` directory or workflow worktree, wrote `root-result.txt` at the parent and `service/nested-result.txt` inside the nested repository, and preserved both fixture files. The nested repository reported only its generated result as untracked.

The clean-Git control `c974369a-eebd-4066-9c76-d469ea0ee40b` retained the existing isolation behavior. Its committed source stayed clean and contained no result file; the result was written under the run's Talos-managed worktree and the UI displayed its workflow branch and base commit.

Both saved runs displayed `Verify exact workspace: Passed` from `run.checks`, followed by unanimous review and the terminal `Every required approval and check passed` state. The direct details contain a Directory and verified-content hash without blank branch/base rows. The control contains its Worktree, branch, base commit and verified-content hash.

## Browser evidence

| Flow | Before start | Completed | Workspace details |
| --- | --- | --- | --- |
| Non-Git parent with nested repository | [Ready](direct-folder-ready.png) | [Overview](direct-folder-complete-overview.png) | [Direct directory and passed check](direct-folder-workspace-details.png) |
| Clean committed Git control | [Ready](clean-git-control-ready.png) | [Overview](clean-git-control-complete-overview.png) | [Isolated worktree metadata and passed check](clean-git-control-workspace-details.png) |

Screenshot hashes and byte sizes are recorded in [manifest.json](manifest.json). Machine/account credentials remain only in the ignored isolated environment.

## Large-workspace observation

A separate read-only probe selected the user's existing `benjamins-v2` parent without starting a workflow or agent there. Preparation selected direct mode in 14 ms without initializing Git. Its 698,805 included files totalled about 89 GB; the full content fingerprint completed locally in 93.5 seconds with bounded parallel hashing. These measurements in [performance.json](performance.json) are local observations, not a latency guarantee. Full verification reads every included file, so large archive workspaces can take minutes; two earlier probes exceeded a 120-second timeout, including one before bounded parallel hashing.

## Reproduce

Build the wire package and CLI, then create an authenticated isolated environment as described in [`docs/dev-environments.md`](../../dev-environments.md). With its API, web app and worktree-built daemon running:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
WORKFLOW_E2E_ENV="$PWD/environments/data/envs/<name>" \
node scripts/evidence/workflow-workspace-folders.cjs
```

The script creates both disposable fixtures, saves its workflow through encrypted account settings, launches both runs in the browser, waits for real completion, verifies filesystem placement and source preservation, and records the screenshots and JSON evidence above. To refresh screenshots and UI assertions from the run IDs already recorded in `validation.json` without starting more provider turns, add `WORKFLOW_CAPTURE_EXISTING=1`.
