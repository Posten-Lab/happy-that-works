/** Translate service failures into recovery instructions; never expose raw RPC, Git or schema output. */
export function workflowErrorMessage(error: unknown, fallback = 'Something went wrong. Try again. If it continues, reconnect this machine in Settings.'): string {
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
    if (/not a git repository|ambiguous argument ['"]?HEAD|unknown revision|bad revision ['"]?HEAD/i.test(message)) return 'Choose a Git project with at least one commit. Open Project to choose another folder.';
    if (/repository root/i.test(message)) return 'Choose the top-level folder of your Git project, rather than a folder inside it. Open Project to change the folder.';
    if (/commit or stash|working tree.*(dirty|clean)|uncommitted/i.test(message)) return 'This project has uncommitted changes. Commit or stash them on the selected machine, then try again. Your files have not been changed.';
    if (/submodules/i.test(message)) return 'Workflows cannot run in projects with Git submodules yet. Choose a different project.';
    if (/spawn\s+(muse|claude|codex).*ENOENT|(?:muse|claude|codex).*(not installed|executable.*not found)/i.test(message)) {
        const provider = /muse/i.test(message) ? 'Muse Code' : /claude/i.test(message) ? 'Claude' : 'Codex';
        return `${provider} is not installed on this machine. Install it there, or choose a machine that already has it.`;
    }
    if (/ENOENT|no such file or directory|directory.*not.*exist|ENOTDIR/i.test(message)) return 'The project folder could not be found on this machine. Open Project to check its location, or choose another machine.';
    if (/EACCES|EPERM|permission denied/i.test(message)) return 'Talos cannot access this project folder. Give your machine’s Talos user access, or choose another project.';
    if (/authentication|unauthorized|not logged in|auth.*login|login.*required|credentials/i.test(message)) return 'An agent provider needs you to sign in on the selected machine. Complete its CLI login there, then try again.';
    if (/reasoning effort.*unavailable/i.test(message)) return 'An agent’s effort setting is unavailable on this machine. Edit the workflow and choose an effort supported by its model.';
    if (/model.*unavailable|model.*not supported/i.test(message)) return 'An agent’s model is unavailable on this machine. Edit the workflow to choose an available model, or choose another machine.';
    if (/maximum three|maximum.*runs|finish or cancel an existing run/i.test(message)) return 'This machine already has three active workflows. Finish or cancel one from Workflows, or choose another machine.';
    if (/update.*CLI|update.*Talos|workflow-start-v[23]|method.*not found|handler.*not found/i.test(message)) return 'This machine needs a newer Talos CLI. Update Talos there and restart its daemon, or choose an up-to-date machine.';
    if (/timeout|timed out|offline|disconnect|not connected|unavailable|ECONN|shutting down|shutdown/i.test(message)) return 'The machine is not responding. Check that it is online and its Talos daemon is running, then try again.';
    if (/saved workflow state could not be read/i.test(message)) return 'Talos could not open the saved workflows on this machine. Existing files are preserved. Reconnect the machine and check its Talos daemon logs.';
    if (/changed.*refresh|revision/i.test(message)) return 'This run changed on another device. Refresh it before trying again.';
    if (/every planner must approve/i.test(message)) return 'The planners have not all agreed yet. Wait for their decisions before approving the plan.';
    if (/explain the change|add a response|clarification/i.test(message)) return 'Add a note explaining what should happen next, then try the action again.';
    if (/current step to stop/i.test(message)) return 'The current agent is still stopping. Wait a moment, then try again.';
    if (/run has finished|run not found/i.test(message)) return 'This run is no longer available for this action. Return to Workflows to open its latest state or start a new run.';
    if (/limit.*reached|exceeded.*limit/i.test(message)) return 'This run reached one of its configured limits. Review the completed work, then start a new run with a smaller task or adjusted limits.';
    return fallback;
}

/** Agent requests and normal coordinator decisions remain intact; runtime diagnostics get recovery copy. */
export function workflowRunMessage(reason: string, tasks: { error?: string; result?: { summary: string } }[]): string {
    if (!reason) return '';
    if (/^(Coordinator (restarted|stopped)|Paused by you|Cancelled by you|Planners need|Planning round limit|Every planner approved|All planners approved|Reviewers need|Review round limit|Completion checks changed|Workspace changed|Current plan approvals)/.test(reason)) return reason;
    if (tasks.some(task => task.error === reason)) return workflowErrorMessage(reason, 'An agent could not finish this step. Open its session to inspect the work, then resume the run when the issue is resolved.');
    if (tasks.some(task => task.result?.summary && reason.endsWith(task.result.summary))) return reason;
    return workflowErrorMessage(reason, 'The workflow stopped before finishing this step. Inspect the latest activity and its session, resolve the issue, then resume. Your work is preserved.');
}
