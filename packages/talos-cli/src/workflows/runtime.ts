import { workflowEnvironment } from './environment';
import { z } from 'zod';
import { spawn } from 'node:child_process';
import { homedir, hostname } from 'node:os';
import { WorkflowDecisionSchema, type WorkflowSlot } from '@ahmadposten/talos-wire';
import { CodexAppServerClient } from '@/codex/codexAppServerClient';
import type { ReasoningEffort } from '@/codex/codexAppServerTypes';
import { ApiClient } from '@/api/api';
import { mapCodexMcpMessageToSessionEnvelopes, type CodexTurnState } from '@/codex/utils/sessionProtocolMapper';
import { prepareWorkspace, workspaceVersion } from './workspace';
import type { WorkflowRuntime } from './coordinator';

export function workflowRuntime(api: ApiClient, home: string): WorkflowRuntime {
    return {
        prepare: i => prepareWorkspace(i.directory, home, i.id), version: workspaceVersion,
        async validate(slots: WorkflowSlot[]) {
            const client = new CodexAppServerClient(undefined, true);
            try {
                await client.connect(); const models = await client.listModels();
                for (const { agent } of slots) {
                    const model = models.find(m => m.model === agent.model);
                    if (!model) throw new Error(`${agent.name}: model ${agent.model} is unavailable on this machine.`);
                    if (agent.effort && !model.supportedReasoningEfforts?.some(e => e.reasoningEffort === agent.effort)) throw new Error(`${agent.name}: reasoning effort is unavailable.`);
                }
            } finally { await client.disconnect(); }
        },
        async turn(run, task, slot, signal, checkpoint) {
            if (signal.aborted) throw new Error('Step cancelled');
            const client = new CodexAppServerClient(undefined, true);
            const session = await api.getOrCreateSession({ tag: `workflow-${run.id}-${task.id}`, metadata: {
                path: run.directory, host: hostname(), homeDir: homedir(), talosHomeDir: home, talosLibDir: '', talosToolsDir: '',
                name: `${slot.agent.name} · ${task.stage}`, summary: { text: `${slot.agent.name} · ${task.stage}`, updatedAt: Date.now() }, machineId: run.machineId, flavor: 'codex',
                workflowRunId: run.id, workflowManaged: true,
            }, state: null });
            if (!session) throw new Error('Could not create the participant session.');
            const sync = api.sessionSyncClient(session);
            task.sessionId = session.id;
            sync.keepAlive(true, 'remote');
            const heartbeat = setInterval(() => sync.keepAlive(true, 'remote'), 2000);
            let answer = '', error = '';
            let eventState: CodexTurnState = { currentTurnId: null };
            client.setApprovalHandler(async () => 'denied');
            client.setEventHandler(event => {
                const mapped = mapCodexMcpMessageToSessionEnvelopes(event, eventState);
                eventState = mapped;
                for (const envelope of mapped.envelopes) sync.sendSessionProtocolMessage(envelope);
                if (event.type === 'agent_message' && typeof event.message === 'string') answer = event.message;
                if (event.type === 'error' || event.type === 'task_complete' && event.error) error = 'Codex reported an error. Inspect the participant session.';
            });
            const stop = () => { void client.disconnect(); };
            signal.addEventListener('abort', stop, { once: true });
            try {
                checkpoint();
                await client.connect(); if (signal.aborted) throw new Error('Step cancelled');
                const sandbox = task.stage === 'execute' ? 'workspace-write' : 'read-only';
                const started = await client.startThread({ cwd: run.directory, model: slot.agent.model, approvalPolicy: 'never', sandbox });
                if (started.model !== slot.agent.model) throw new Error('Codex selected a different model; workflow stopped.');
                task.threadId = started.threadId; checkpoint();
                sync.updateMetadata(m => ({ ...m, codexThreadId: started.threadId }));
                sync.sendProviderUserMessage(task.prompt, task.id);
                const result = await client.sendTurnAndWait(task.prompt, { cwd: run.directory, model: slot.agent.model,
                    effort: (slot.agent.effort ?? undefined) as ReasoningEffort | undefined, approvalPolicy: 'never', sandbox,
                    outputSchema: z.toJSONSchema(WorkflowDecisionSchema), turnTimeoutMs: run.definition.turnMinutes * 60000 });
                if (result.aborted || signal.aborted || error) throw new Error(error || 'Agent interrupted or step time limit reached. Inspect before retrying.');
                if (answer.length > 64000) throw new Error('Agent result exceeded the workflow limit.');
                const decision = WorkflowDecisionSchema.parse(JSON.parse(answer));
                if (decision.decision === 'approve' && decision.findings.some(f => f.blocking)) throw new Error('Agent returned approval with blocking findings. Inspect the inconsistent result.');
                return decision;
            } finally {
                clearInterval(heartbeat);
                signal.removeEventListener('abort', stop); await client.disconnect();
                sync.sendSessionDeath(); await sync.flush(); await sync.close();
            }
        },
        async check(directory, command, signal) {
            if (signal.aborted) throw new Error('Check cancelled');
            return new Promise((resolve, reject) => {
                const env = workflowEnvironment(process.env, false);
                const child = spawn(process.platform === 'win32' ? 'cmd.exe' : '/bin/sh', process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command], {
                    cwd: directory, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
                });
                let output = '', timedOut = false;
                const append = (b: Buffer) => { output = (output + b.toString()).slice(-24000); };
                child.stdout.on('data', append); child.stderr.on('data', append);
                const stop = () => { try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {} };
                const timer = setTimeout(() => { timedOut = true; stop(); }, 5 * 60000);
                signal.addEventListener('abort', stop, { once: true });
                const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', stop); };
                child.on('error', e => { cleanup(); reject(e); });
                child.on('close', code => { cleanup(); if (signal.aborted) reject(new Error('Check interrupted.')); else resolve({ exitCode: timedOut ? null : code, output: timedOut ? `Check time limit reached.\n${output}` : output }); });
            });
        },
    };
}
