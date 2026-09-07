# Agent Workflow

## npm publishing credentials

- Use `pnpm release <target> --publish` for npm releases. It selects the canonical
  private credential file `~/.config/talos/npm-publish.npmrc`; do not substitute
  the general npm login or ask for a new token while this credential works.
- Rotate the credential with `python3 scripts/configure-npm-publishing.py`.
  Never print, commit, or paste its contents into logs, PRs, or chat.
- A future CI publishing job must bind the same approved credential as a private
  file and set `TALOS_NPM_USERCONFIG` to its absolute path. Existing Jenkins
  web/API/mobile deployments do not publish npm packages.
- See [the npm publishing runbook](docs/rebrand/npm-publishing.md) for the
  credential location, release procedure, and current automation boundaries.

## Required delivery workflow

- Every Talos change must go through a pull request. Never push directly to
  `main` or `master`, including releases and requests to “sync to main”.
- Work on a feature branch. Push the branch and open/update its PR as part of
  completing the work; do not ask for push permission each time.
- Run the relevant tests before submitting a PR. Test failures must be fixed;
  do not claim unrun or failing checks passed.
- Real end-to-end validation is required for every change. Exercise the affected
  flow with actual services/tools. Mocks and unit tests alone are not E2E evidence.
  Record commands, results, and evidence in the PR. If access prevents E2E,
  report the blocker and leave the work incomplete rather than claiming success.
- For UI changes, exercise the UI in a simulator or real browser and attach the
  resulting screenshots to the PR. Include accessible evidence links in its body.
- Preserve unrelated working-tree changes; use a separate worktree when needed.

## Sync to main

When the user says `sync to main` or `synt to main`, fetch `origin/main`, rebase
this work's feature branch onto it, run required tests and E2E, push the feature
branch, and open/update its PR targeting `main`. Never push HEAD directly to main.
