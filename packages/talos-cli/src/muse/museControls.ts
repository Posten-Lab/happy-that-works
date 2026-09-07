import { musePermissionModes } from './museProtocol';

export const museEffortLevels = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
export type MuseEffort = typeof museEffortLevels[number];
export type MuseControlState = { permissionMode: string; effort: MuseEffort; hostArgs: string[] };
export interface MuseControlStore {
    load(sessionId: string): MuseControlState | undefined;
    save(sessionId: string, state: MuseControlState): void;
}

export function museEffort(value: string): MuseEffort {
    if (!museEffortLevels.includes(value as MuseEffort)) throw new Error(`Unsupported Muse reasoning effort: ${value}`);
    return value as MuseEffort;
}

// Native CLI verification: --reasoning-effort max sends xhigh to Meta.
// MSP's closed enum accepts xhigh, but rejects the CLI alias max.
export function museWireEffort(value: MuseEffort) { return value === 'max' ? 'xhigh' : value; }

export function parseMuseControls(args: string[]) {
    const overrides: Partial<MuseControlState> = {};
    const remaining: string[] = [];
    const hostArgs: string[] = [];
    for (let i = 0; i < args.length; i++) {
        const [flag, inline] = args[i].split(/=(.*)/s);
        const value = () => {
            const v = inline ?? args[++i];
            if (!v || v.startsWith('--')) throw new Error(`${flag} requires a value`);
            return v;
        };
        if (flag === '--reasoning-effort') overrides.effort = museEffort(value());
        else if (flag === '--approval-mode') {
            const mode = value();
            const mapping: Record<string, string> = { untrusted: 'default', 'on-request': 'safe-yolo', never: 'never' };
            if (!mapping[mode]) throw new Error(`Unsupported Muse approval mode: ${mode}`);
            overrides.permissionMode = mapping[mode];
        } else if (flag === '--yolo') overrides.permissionMode = 'yolo';
        else if (flag === '--disable-approval') overrides.permissionMode = 'bypassPermissions';
        else if (['--disable-sandbox', '--disable-shell', '--disable-write', '--trust-workspace'].includes(flag)) hostArgs.push(flag);
        else if (flag === '--sandbox-network') {
            const network = value();
            if (!['restricted', 'enabled', 'proxy-only'].includes(network)) throw new Error(`Unsupported Muse sandbox network: ${network}`);
            const previous = hostArgs.indexOf(flag);
            if (previous !== -1) hostArgs.splice(previous, 2);
            hostArgs.push(flag, network);
        } else remaining.push(args[i]);
    }
    // Native bypass flags take precedence over the prompting policy.
    if (args.includes('--yolo')) overrides.permissionMode = 'yolo';
    else if (args.includes('--disable-approval')) overrides.permissionMode = 'bypassPermissions';
    if (hostArgs.length) overrides.hostArgs = hostArgs;
    return { overrides, remaining };
}

export function museHostArgs(state: MuseControlState): string[] {
    return [...new Set([...state.hostArgs, ...(state.permissionMode === 'yolo' ? ['--disable-sandbox', '--trust-workspace'] : [])])];
}

export function museTerminalArgs(state: MuseControlState, remaining: string[]): string[] {
    const approval = state.permissionMode === 'yolo' ? ['--yolo']
        : state.permissionMode === 'bypassPermissions' ? ['--disable-approval']
        : ['--approval-mode', state.permissionMode === 'never' ? 'never' : state.permissionMode === 'safe-yolo' ? 'on-request' : 'untrusted'];
    return [...remaining, ...state.hostArgs, ...approval, '--reasoning-effort', state.effort];
}

export function musePermissionFromNative(native: string, current: string): string {
    if (native === 'allowAll' && current === 'yolo') return 'yolo';
    return musePermissionModes.find(m => m.native === native)?.id ?? current;
}
