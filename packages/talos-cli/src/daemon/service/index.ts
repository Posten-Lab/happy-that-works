import { createRequire } from 'node:module'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { projectPath } from '@/projectPath'
import { configuration } from '@/configuration'

export interface ServiceResult {
  managed: boolean
  active?: boolean
  restarted?: boolean
  manager?: 'launchd' | 'systemd' | 'openrc'
  serviceFile?: string
  reason?: string
  message?: string
}

export interface ServiceStatus {
  manager: 'launchd' | 'systemd' | 'openrc' | null
  enabled: boolean
  installed: boolean
  active: boolean
  name: string
  serviceFile?: string
}

const serviceScript = join(projectPath(), 'scripts', 'daemon-service.cjs')
const service = createRequire(import.meta.url)(serviceScript) as {
  ensureService(options: Record<string, unknown>): ServiceResult
  stopService(options: Record<string, unknown>): boolean
  uninstallService(options: Record<string, unknown>): void
  serviceStatus(options: Record<string, unknown>): ServiceStatus
  pauseService(options: Record<string, unknown>): void
  isServicePaused(options: Record<string, unknown>): boolean
}

function options() {
  return {
    packageRoot: projectPath(),
    talosHome: configuration.talosHomeDir,
    env: { ...process.env, TALOS_SERVER_URL: configuration.serverUrl, TALOS_WEBAPP_URL: configuration.webappUrl },
    allowPrompt: Boolean(process.stdin.isTTY && !process.env.CI),
  }
}

export async function ensureDaemonService(overrides: { restart?: boolean; enable?: boolean; allowPrompt?: boolean } = {}): Promise<ServiceResult> {
  return service.ensureService({ ...options(), ...overrides })
}

export async function stopDaemonService(): Promise<boolean> {
  return service.stopService(options())
}

export async function uninstallDaemonService(): Promise<void> {
  service.uninstallService(options())
}

export function getDaemonServiceStatus(): ServiceStatus {
  return service.serviceStatus(options())
}

export function isDaemonServicePaused(): boolean {
  return service.isServicePaused(options())
}

export function pauseDaemonService(): void {
  service.pauseService(options())
}

/** Call after cleanup when the managed daemon itself receives a stop request. */
export function requestManagedServiceStop(): void {
  pauseDaemonService()
  const helper = spawn(process.execPath, [serviceScript, 'stop'], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, TALOS_HOME_DIR: configuration.talosHomeDir },
  })
  helper.unref()
}
