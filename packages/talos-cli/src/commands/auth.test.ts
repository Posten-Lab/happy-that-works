import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  credentials: vi.fn(), settings: vi.fn(), clearCredentials: vi.fn(), clearMachineId: vi.fn(),
  authenticate: vi.fn(), ensureDaemon: vi.fn(), stopService: vi.fn(), stopDaemon: vi.fn(),
}))
vi.mock('@/persistence', () => ({
  readCredentials: mocks.credentials, readSettings: mocks.settings,
  clearCredentials: mocks.clearCredentials, clearMachineId: mocks.clearMachineId,
}))
vi.mock('@/ui/auth', () => ({ authAndSetupMachineIfNeeded: mocks.authenticate }))
vi.mock('@/configuration', () => ({ configuration: { talosHomeDir: '/unused-auth-test' } }))
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn() } }))
vi.mock('@/daemon/controlClient', () => ({ stopDaemon: mocks.stopDaemon, checkIfDaemonRunningAndCleanupStaleState: vi.fn() }))
vi.mock('@/daemon/service', () => ({ stopDaemonService: mocks.stopService }))
vi.mock('@/daemon/ensureDaemonRunning', () => ({ ensureDaemonRunning: mocks.ensureDaemon }))

import { handleAuthCommand } from './auth'

describe('auth login background service setup', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    mocks.authenticate.mockResolvedValue({ machineId: 'registered-machine' })
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('starts the service after first account connection without requiring a coding session', async () => {
    await handleAuthCommand(['login'])
    expect(mocks.authenticate).toHaveBeenCalledOnce()
    expect(mocks.ensureDaemon).toHaveBeenCalledOnce()
    expect(mocks.authenticate.mock.invocationCallOrder[0]).toBeLessThan(mocks.ensureDaemon.mock.invocationCallOrder[0])
  })

  it('repairs service installation when the account is already connected', async () => {
    mocks.credentials.mockResolvedValue({ token: 'test-only' })
    mocks.settings.mockResolvedValue({ machineId: 'existing-machine' })
    await handleAuthCommand(['login'])
    expect(mocks.authenticate).not.toHaveBeenCalled()
    expect(mocks.ensureDaemon).toHaveBeenCalledOnce()
  })

  it('stops OS supervision before replacing credentials and restarts after authentication', async () => {
    await handleAuthCommand(['login', '--force'])
    expect(mocks.stopService.mock.invocationCallOrder[0]).toBeLessThan(mocks.clearCredentials.mock.invocationCallOrder[0])
    expect(mocks.stopDaemon).toHaveBeenCalledOnce()
    expect(mocks.ensureDaemon).toHaveBeenCalledOnce()
  })

  it('preserves credentials when stopping OS supervision fails', async () => {
    mocks.stopService.mockRejectedValue(new Error('Service stop denied'))
    await expect(handleAuthCommand(['login', '--force'])).rejects.toThrow('Service stop denied')
    expect(mocks.clearCredentials).not.toHaveBeenCalled()
    expect(mocks.authenticate).not.toHaveBeenCalled()
  })
})
