import { assertMuseNativeArgs } from '@/muse/museModelPolicy';
import { authAndSetupMachineIfNeeded } from '@/ui/auth';
import { ensureDaemonRunning } from '@/daemon/ensureDaemonRunning';
import { runMuse } from '@/muse/runMuse';

export function parseMuseArgs(args: string[]) {
    let resumeId: string | undefined;
    let startedBy: 'daemon' | 'terminal' | undefined;
    let startingMode: 'local' | 'remote' | undefined;
    const nativeArgs: string[] = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--') { nativeArgs.push(...args.slice(i + 1)); break; }
        if (arg === '--resume') {
            resumeId = args[++i];
            if (!resumeId || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(resumeId)) throw new Error('--resume requires a Muse session UUID');
        } else if (arg === '--started-by') {
            const value = args[++i];
            if (value !== 'daemon' && value !== 'terminal') throw new Error('--started-by must be daemon or terminal');
            startedBy = value;
        } else if (arg === '--talos-starting-mode') {
            const value = args[++i];
            if (value !== 'local' && value !== 'remote') throw new Error('--talos-starting-mode must be local or remote');
            startingMode = value;
        } else throw new Error(`Unknown Talos Muse option: ${arg}. Pass native Muse options after --.`);
    }
    if (nativeArgs.some(arg => ['--no-session-log', '--workspace', '--worktree', '-w', '--worktree-existing'].some(flag => arg === flag || arg.startsWith(`${flag}=`)))) {
        throw new Error('Session persistence and workspace are managed by Talos; choose the workspace before launching');
    }
    assertMuseNativeArgs(nativeArgs);
    if (startedBy === 'daemon' && startingMode === 'local') throw new Error('Daemon sessions need remote control');
    return { resumeId, startedBy, startingMode, nativeArgs };
}

export async function handleMuseCommand(args: string[]) {
    if (args.includes('--help') || args.includes('-h')) {
        console.log('talos muse [--resume <muse-session-uuid>] [--talos-starting-mode local|remote] [-- <native options>]\n\nLaunch the native Muse terminal, then continue the same session in Talos. Model changes are temporarily disabled; use Muse Spark 1.3 Contributor.\nInstall Muse from https://dev.meta.ai and authenticate with: muse login');
        return;
    }
    const options = parseMuseArgs(args);
    const { credentials } = await authAndSetupMachineIfNeeded();
    await ensureDaemonRunning();
    await runMuse({ credentials, ...options });
}
