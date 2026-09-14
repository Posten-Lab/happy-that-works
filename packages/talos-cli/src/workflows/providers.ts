import { z } from 'zod';
import { homedir, hostname } from 'node:os';
import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import { WorkflowDecisionOutputSchema, WorkflowDecisionSchema } from '@ahmadposten/talos-wire';
import type { WorkflowRuntime } from './coordinator';
import type { ApiClient } from '@/api/api';
import type { RawJSONLines } from '@/claude/types';
import { discoverClaudeModels } from '@/claude/claudeModels';
import { discoverMuseModels } from '@/muse/museClient';
import type { MuseMessage } from '@/muse/museProtocol';
import { MuseSession } from '@/muse/MuseSession';
import { claudeWorkflowEnvironment } from './environment';

export const discoverWorkflowProviderModels = (provider: 'claude' | 'muse') => provider === 'claude' ? discoverClaudeModels() : discoverMuseModels(homedir());

/** Resolve existing ancestors as well as the target so symlinked paths cannot escape the worktree. */
export function workflowWritePath(directory: string, value: unknown): boolean {
    if (typeof value !== 'string' || !value) return false;
    const root = realpathSync(directory), target = resolve(directory, value);
    let existing = target, suffix: string[] = [];
    for (;;) {
        try { existing = realpathSync(existing); break; }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(existing) === existing) return false;
            suffix.unshift(existing.slice(dirname(existing).length + 1)); existing = dirname(existing);
        }
    }
    const distance = relative(root, resolve(existing, ...suffix));
    return distance !== '..' && !distance.startsWith(`..${sep}`) && !isAbsolute(distance);
}
export function claudeWorkflowOptions(directory: string, writable: boolean): Pick<Options, 'tools' | 'settingSources' | 'mcpServers' | 'strictMcpConfig' | 'sandbox' | 'permissionMode' | 'canUseTool'> {
    return {
        settingSources: [], mcpServers: {}, strictMcpConfig: true,
        tools: writable ? ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash'] : ['Read', 'Glob', 'Grep'],
        permissionMode: 'default',
        sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false,
            autoAllowBashIfSandboxed: writable, filesystem: { allowWrite: writable ? [directory] : [] } },
        canUseTool: async (tool, input) => {
            const allowed = ['Read', 'Glob', 'Grep'].includes(tool) || writable &&
                (['Write', 'Edit'].includes(tool) && workflowWritePath(directory, input.file_path) || tool === 'Bash' && input.dangerouslyDisableSandbox !== true);
            return allowed ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'This workflow step cannot perform that operation.' };
        },
    };
}
export function workflowDecision(value: unknown) {
    const decision = WorkflowDecisionSchema.parse(value);
    if (Buffer.byteLength(JSON.stringify(decision)) > 64000) throw new Error('Agent result exceeded the workflow limit.');
    if (decision.decision === 'approve' && decision.findings.some(f => f.blocking)) throw new Error('Agent returned approval with blocking findings. Inspect the inconsistent result.');
    return decision;
}

export function museWorkflowAnswer(message: MuseMessage): string | undefined {
    // Native reminders also map to visible messages; only agentMessage items use the text part.
    return message.data?.type === 'message' && message.id.endsWith(':text') ? message.data.message : undefined;
}

export function providerWorkflowTurn(api: ApiClient, home: string): WorkflowRuntime['turn'] {
    return async (run, task, slot, signal, checkpoint) => {
        if (signal.aborted) throw new Error('Step cancelled');
        const session = await api.getOrCreateSession({ tag: `workflow-${run.id}-${task.id}`, metadata: {
            path: run.directory, host: hostname(), homeDir: homedir(), talosHomeDir: home, talosLibDir: '', talosToolsDir: '',
            name: `${slot.agent.name} · ${task.stage}`, summary: { text: `${slot.agent.name} · ${task.stage}`, updatedAt: Date.now() },
            machineId: run.machineId, flavor: slot.agent.provider, workflowRunId: run.id, workflowManaged: true,
        }, state: null });
        if (!session) throw new Error('Could not create the participant session.');
        const sync = api.sessionSyncClient(session); task.sessionId = session.id; checkpoint();
        sync.keepAlive(true, 'remote'); const heartbeat = setInterval(() => sync.keepAlive(true, 'remote'), 2000);
        const abort = new AbortController();
        let timedOut = false;
        const cancel = () => abort.abort(); signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) cancel();
        const timer = setTimeout(() => { timedOut = true; cancel(); }, run.definition.turnMinutes * 60000);
        let close: (() => Promise<void> | void) | undefined;
        try {
            sync.sendProviderUserMessage(task.prompt, task.id);
            if (slot.agent.provider === 'claude') {
                const env = claudeWorkflowEnvironment(process.env);
                const client = query({ prompt: task.prompt, options: {
                    ...claudeWorkflowOptions(run.directory, task.stage === 'execute'), cwd: run.directory,
                    env, model: slot.agent.model, effort: (slot.agent.effort ?? undefined) as Options['effort'],
                    abortController: abort, maxTurns: 40, outputFormat: { type: 'json_schema', schema: z.toJSONSchema(WorkflowDecisionOutputSchema, { target: 'draft-7' }) },
                } });
                close = () => client.close();
                let result: unknown;
                for await (const message of client) {
                    if (abort.signal.aborted) throw new Error('Agent interrupted or step time limit reached.');
                    sync.sendClaudeSessionMessage(message as unknown as RawJSONLines);
                    if (message.type === 'assistant' && message.error === 'authentication_failed') throw new Error('Claude authentication failed on this machine. Run claude auth login, then retry this workflow step.');
                    if (message.type === 'system' && message.subtype === 'init') {
                        task.threadId = message.session_id; checkpoint(); sync.updateMetadata(m => ({ ...m, claudeSessionId: message.session_id }));
                    }
                    if (message.type === 'result') {
                        if (message.subtype !== 'success' || message.is_error) throw new Error('Claude reported an error. Inspect the participant session.');
                        result = message.structured_output;
                    }
                }
                if (abort.signal.aborted) throw new Error('Agent interrupted or step time limit reached.');
                return workflowDecision(result);
            }
            if (slot.agent.provider !== 'muse') throw new Error('Unsupported workflow provider.');
            let answer = '', providerError: Error | undefined;
            const client = new MuseSession(run.directory, {
                message: message => {
                    if (message.data) {
                        sync.sendAgentMessage('muse', message.data, message.id);
                        const text = museWorkflowAnswer(message);
                        if (text !== undefined) answer = text;
                    }
                },
                metadata: metadata => sync.updateMetadata(m => ({ ...m, ...metadata })), mode: () => {}, activity: () => {},
                notice: message => sync.sendAgentMessage('muse', { type: 'message', message }),
                permission: async () => ({ decision: 'denied' }), exited: error => { providerError = error; },
            }, ['--approval-mode', 'never', ...(task.stage === 'execute' ? [] : ['--disable-write', '--disable-shell'])]);
            close = () => client.dispose();
            const stop = () => { void client.cancel().catch(() => {}); };
            abort.signal.addEventListener('abort', stop, { once: true });
            try {
                if (abort.signal.aborted) throw new Error('Step cancelled');
                await client.start();
                task.threadId = client.sessionId; checkpoint();
                if (abort.signal.aborted) throw new Error('Step cancelled');
                await client.prompt(`${task.prompt}\nReturn one JSON object matching this schema, with no Markdown fences or other text:\n${JSON.stringify(z.toJSONSchema(WorkflowDecisionOutputSchema))}`,
                    { model: slot.agent.model, effort: slot.agent.effort ?? undefined, permissionMode: 'never' });
                if (abort.signal.aborted || providerError) throw providerError ?? new Error(timedOut ? 'Step time limit reached.' : 'Step cancelled');
                if (answer.length > 64000) throw new Error('Agent result exceeded the workflow limit.');
                return workflowDecision(JSON.parse(answer));
            } finally { abort.signal.removeEventListener('abort', stop); }
        } finally {
            clearInterval(heartbeat); clearTimeout(timer); signal.removeEventListener('abort', cancel);
            try { await close?.(); } finally { sync.sendSessionDeath(); await sync.flush(); await sync.close(); }
        }
    };
}
