import { existsSync } from 'node:fs';

import type { Metadata } from '@/api/types';
import { spawnTalosCLI } from '@/utils/spawnTalosCLI';

import { resolveTalosSession, type ResumableTalosSession } from './resolveTalosSession';

export type ResumeLaunch = {
    cwd: string;
    args: string[];
};

export type ResumeLaunchOptions = {
    claudeStartingMode?: 'local' | 'remote';
    startedBy?: 'daemon' | 'terminal';
};

export function parseResumeCommandArgs(args: string[]): { showHelp: boolean; sessionId: string } {
    if (args.includes('-h') || args.includes('--help')) {
        return {
            showHelp: true,
            sessionId: '',
        };
    }

    if (args.length === 0) {
        throw new Error('Talos session ID is required: talos resume <session-id>');
    }
    if (args.length > 1) {
        throw new Error(`Unexpected arguments for talos resume: ${args.slice(1).join(' ')}`);
    }

    return {
        showHelp: false,
        sessionId: args[0],
    };
}

function resolveFlavor(metadata: Metadata): 'codex' | 'claude' | 'muse' | null {
    if (metadata.flavor === 'muse') return 'muse';
    if (metadata.flavor === 'codex' || metadata.codexThreadId) {
        return 'codex';
    }
    if (metadata.flavor === 'claude' || metadata.claudeSessionId) {
        return 'claude';
    }
    return null;
}

export function buildResumeLaunch(session: ResumableTalosSession, options: ResumeLaunchOptions = {}): ResumeLaunch {
    const { metadata } = session;
    const flavor = resolveFlavor(metadata);

    if (flavor === 'muse') {
        if (!metadata.museSessionId) throw new Error('Talos session is missing its Muse session ID');
        return { cwd: metadata.path, args: ['muse', '--resume', metadata.museSessionId, '--talos-starting-mode', 'remote', ...(options.startedBy ? ['--started-by', options.startedBy] : [])] };
    }

    if (flavor === 'codex') {
        if (!metadata.codexThreadId) {
            throw new Error(`Talos session ${session.id} is missing its Codex thread ID.`);
        }
        const args = ['codex', '--resume', metadata.codexThreadId];
        if (options.startedBy) {
            args.push('--started-by', options.startedBy);
        }
        return {
            cwd: metadata.path,
            args,
        };
    }

    if (flavor === 'claude') {
        if (!metadata.claudeSessionId) {
            throw new Error(`Talos session ${session.id} is missing its Claude session ID.`);
        }
        const args = ['claude'];
        if (options.claudeStartingMode) {
            args.push('--talos-starting-mode', options.claudeStartingMode);
        }
        if (options.startedBy) {
            args.push('--started-by', options.startedBy);
        }
        args.push('--resume', metadata.claudeSessionId);
        return {
            cwd: metadata.path,
            args,
        };
    }

    throw new Error(`Talos session ${session.id} uses unsupported flavor "${metadata.flavor ?? 'unknown'}".`);
}

export function formatResumeHelp(): string {
    return [
        'talos resume - Resume a previous Talos session',
        '',
        'Usage:',
        '  talos resume <talos-session-id>',
        '',
        'Examples:',
        '  talos resume cmmij8olq00dp5jcxr3wtbpau',
        '  talos resume cmmij8',
        '',
        'This reuses the saved worktree/path and resumes the underlying agent session',
        'when the backend supports it.',
    ].join('\n');
}

function spawnResumeChild(launch: ResumeLaunch): Promise<number | null> {
    return new Promise((resolve, reject) => {
        const child = spawnTalosCLI(launch.args, {
            cwd: launch.cwd,
            env: process.env,
            stdio: 'inherit',
        });

        child.once('error', reject);
        child.once('exit', (code, signal) => {
            if (signal) {
                reject(new Error(`Resumed session exited via signal ${signal}`));
                return;
            }
            resolve(code);
        });
    });
}

export async function handleResumeCommand(args: string[]): Promise<void> {
    const parsed = parseResumeCommandArgs(args);
    if (parsed.showHelp) {
        console.log(formatResumeHelp());
        return;
    }

    const session = await resolveTalosSession(parsed.sessionId);
    if (session.active) {
        throw new Error('This session is still running. Continue in its existing terminal or the Talos app; a duplicate agent was not started.');
    }
    const launch = buildResumeLaunch(session);

    if (!existsSync(launch.cwd)) {
        throw new Error(`Saved session path does not exist: ${launch.cwd}`);
    }

    const exitCode = await spawnResumeChild(launch);
    if (typeof exitCode === 'number' && exitCode !== 0) {
        process.exit(exitCode);
    }
}
