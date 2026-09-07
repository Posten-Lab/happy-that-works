import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { win32 } from 'node:path';

function linuxProcessFields(pid: number): string[] {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ');
}

function psStart(pid: number): string {
    return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], {
        encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, LC_ALL: 'C' },
    }).trim();
}

function windowsStart(pid: number): string | null {
    const powershell = win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const value = execFileSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
        "$ErrorActionPreference = 'Stop'; (Get-Process -Id ([int]$env:TALOS_PROCESS_QUERY_PID)).StartTime.ToUniversalTime().ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)",
    ], {
        encoding: 'utf8', timeout: 2000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
        // The PowerShell program is constant; the validated numeric PID is data.
        env: { ...process.env, TALOS_PROCESS_QUERY_PID: String(pid) },
    }).trim();
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
}

/** Kernel process birth identity distinguishes a reused PID, including after reboot. */
export function getProcessIdentity(pid: number): string | null {
    if (!Number.isSafeInteger(pid) || pid <= 0) return null;
    try {
        if (process.platform === 'win32') return windowsStart(pid);
        if (process.platform === 'linux') {
            const fields = linuxProcessFields(pid);
            if (fields[0] === 'Z') return null;
            return `${readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()}:${fields[19]}`;
        }
        return psStart(pid) || null;
    } catch { return null; }
}

let clockTicks: number | undefined;
/** Used only to recognize stale legacy locks, which did not record a birth identity. */
export function getProcessStartTime(pid: number): number | null {
    if (!Number.isSafeInteger(pid) || pid <= 0) return null;
    try {
        if (process.platform === 'win32') {
            const value = windowsStart(pid);
            return value === null ? null : Date.parse(value);
        }
        if (process.platform === 'linux') {
            const fields = linuxProcessFields(pid);
            if (fields[0] === 'Z') return null;
            clockTicks ??= Number(execFileSync('getconf', ['CLK_TCK'], {
                encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'],
            }).trim());
            const boot = /^btime\s+(\d+)$/m.exec(readFileSync('/proc/stat', 'utf8'));
            if (!boot || !clockTicks || !Number.isFinite(clockTicks)) return null;
            return (Number(boot[1]) + Number(fields[19]) / clockTicks) * 1000;
        }
        const parsed = Date.parse(psStart(pid));
        return Number.isFinite(parsed) ? parsed : null;
    } catch { return null; }
}
