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
    it('keeps agent clarification requests and planning approval reasons', () => {
        expect(workflowRunMessage('Which environment should I use?', [{ result: { summary: 'Which environment should I use?' } }])).toBe('Which environment should I use?');
        expect(workflowRunMessage('All planners approved Plan. Your approval is required to continue.', [])).toContain('Your approval');
    });
    it('does not show raw schema and filesystem failures as status copy', () => {
        expect(workflowRunMessage('[{"code":"invalid_type","path":["decision"]}]', [])).not.toContain('invalid_type');
        expect(workflowRunMessage('EPERM: permission denied', [])).toContain('cannot access');
    });
});
