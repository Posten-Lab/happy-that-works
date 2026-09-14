import { describe, expect, it } from 'vitest';
import { workflowErrorMessage, workflowRunMessage } from './errors';

describe('workflow failure explanations', () => {
    it.each([
        ['fatal: not a git repository (or any parent directory): .git', 'Git project with at least one commit'],
        ['Choose the Git repository root directory.', 'top-level folder'],
        ['Commit or stash project changes before starting a workflow.', 'uncommitted changes'],
        ["ENOENT: no such file or directory, realpath '/private/project'", 'folder could not be found'],
        ['spawn muse ENOENT', 'Muse Code is not installed'],
        ['spawn claude ENOENT', 'Claude is not installed'],
        ['executor: model unknown is unavailable on this machine.', 'model is unavailable'],
        ['reviewer: reasoning effort is unavailable.', 'effort setting is unavailable'],
        ['Finish or cancel an existing run before starting another (maximum three).', 'three active workflows'],
        ['Claude authentication failed; run claude auth login', 'sign in'],
        ['machine RPC timed out', 'machine is not responding'],
        ['EACCES: permission denied', 'cannot access'],
    ])('explains %s with a recovery action', (error, recovery) => {
        const friendly = workflowErrorMessage(new Error(error));
        expect(friendly).toContain(recovery);
        expect(friendly).not.toContain('/private/project');
    });
    it('hides unrecognized transport and schema diagnostics behind contextual guidance', () => {
        expect(workflowErrorMessage(new Error('[{"code":"invalid_type","path":["agent"]}]'), 'Review the workflow and try again.')).toBe('Review the workflow and try again.');
        expect(workflowErrorMessage({ secret: 'private' })).not.toContain('private');
    });
});


describe('workflowRunMessage', () => {
    it('maps provider failures while retaining diagnostics separately', () => {
        const raw = 'spawn muse ENOENT';
        expect(workflowRunMessage(raw, [{ error: raw }])).toContain('Muse Code is not installed');
    });
    it('explains an unreadable agent response without exposing parser diagnostics or changing an agent request', () => {
        const raw = 'Unexpected non-whitespace character after JSON at position 741 (line 2 column 1)';
        const friendly = workflowRunMessage(raw, [{ error: raw }]);
        expect(friendly).toContain('response Talos could not read');
        expect(friendly).toContain('then resume');
        expect(friendly).not.toContain('JSON');
        expect(workflowRunMessage('Which JSON format do you want?', [{ result: { summary: 'Which JSON format do you want?' } }])).toBe('Which JSON format do you want?');
    });
    it('keeps agent clarification requests and planning approval reasons', () => {
        expect(workflowRunMessage('Which environment should I use?', [{ result: { summary: 'Which environment should I use?' } }])).toBe('Which environment should I use?');
        expect(workflowRunMessage('All planners approved Plan. Your approval is required to continue.', [])).toContain('Your approval');
    });
    it('explains command-runner failures even when an agent included them in its result summary', () => {
        const summary = 'Implementation written, but Bash failed with E2BIG exec argument limit on every command.';
        expect(workflowRunMessage(summary, [{ result: { summary } }])).toContain('command runner could not start');
        expect(workflowRunMessage(summary, [{ result: { summary } }])).not.toContain('E2BIG');
    });
    it('does not show raw schema and filesystem failures as status copy', () => {
        expect(workflowRunMessage('[{"code":"invalid_type","path":["decision"]}]', [])).toContain('response Talos could not read');
        expect(workflowRunMessage('EPERM: permission denied', [])).toContain('cannot access');
    });
});
