import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function talosHomeName(platform: NodeJS.Platform = process.platform): 'Talos' | 'talos' {
    return platform === 'linux' ? 'talos' : 'Talos'
}

export function talosHomeDir(
    platform: NodeJS.Platform = process.platform,
    homeDir: string = homedir(),
): string {
    return join(homeDir, talosHomeName(platform))
}

export function ensureTalosHomeDir(): string {
    const dir = talosHomeDir()
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    return dir
}

export function stateDatabasePath(): string {
    return join(ensureTalosHomeDir(), 'state.sqlite')
}

export function workspacesRootDir(): string {
    return join(ensureTalosHomeDir(), 'workspaces')
}

export function projectWorkspacesDir(projectName: string): string {
    return join(workspacesRootDir(), projectName)
}

export function storageFilePath(filename: string): string {
    return join(ensureTalosHomeDir(), filename)
}
