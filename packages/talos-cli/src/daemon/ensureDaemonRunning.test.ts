import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mockLoggerDebug: vi.fn(),
  mockIsDaemonRunningCurrentlyInstalledTalosVersion: vi.fn(),
  mockCheckIfDaemonRunningAndCleanupStaleState: vi.fn(),
  mockSpawnTalosCLI: vi.fn(),
  mockEnsureDaemonService: vi.fn(),
  mockGetDaemonServiceStatus: vi.fn(),
  mockStopDaemon: vi.fn(),
}))

vi.mock('@/ui/logger', () => ({
  logger: {
    debug: mocks.mockLoggerDebug,
  },
}))

vi.mock('./controlClient', () => ({
  isDaemonRunningCurrentlyInstalledTalosVersion: mocks.mockIsDaemonRunningCurrentlyInstalledTalosVersion,
  checkIfDaemonRunningAndCleanupStaleState: mocks.mockCheckIfDaemonRunningAndCleanupStaleState,
  stopDaemon: mocks.mockStopDaemon,
}))

vi.mock('./service', () => ({
  ensureDaemonService: mocks.mockEnsureDaemonService,
  getDaemonServiceStatus: mocks.mockGetDaemonServiceStatus,
}))

vi.mock('@/utils/spawnTalosCLI', () => ({
  spawnTalosCLI: mocks.mockSpawnTalosCLI,
}))

import { ensureDaemonRunning } from './ensureDaemonRunning'

describe('ensureDaemonRunning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.TALOS_SERVICE_MANAGED
    delete process.env.TALOS_DAEMON_CHILD
    mocks.mockGetDaemonServiceStatus.mockReturnValue({ enabled: false, installed: false, active: false, manager: null })
    mocks.mockEnsureDaemonService.mockResolvedValue({ managed: false, reason: 'disabled' })
    mocks.mockSpawnTalosCLI.mockReturnValue({
      unref: vi.fn(),
    })
    mocks.mockCheckIfDaemonRunningAndCleanupStaleState.mockResolvedValue(true)
  })

  it('repairs automatic startup even when a daemon is already running', async () => {
    mocks.mockIsDaemonRunningCurrentlyInstalledTalosVersion.mockResolvedValue(true)
    mocks.mockGetDaemonServiceStatus.mockReturnValue({ enabled: true, manager: 'launchd', active: false })
    mocks.mockEnsureDaemonService.mockResolvedValue({ managed: true })

    await ensureDaemonRunning()

    expect(mocks.mockStopDaemon).toHaveBeenCalledOnce()
    expect(mocks.mockEnsureDaemonService).toHaveBeenCalledWith({ restart: true })
    expect(mocks.mockSpawnTalosCLI).not.toHaveBeenCalled()
    expect(mocks.mockCheckIfDaemonRunningAndCleanupStaleState).toHaveBeenCalled()
  })

  it('leaves starting and restarting to the OS supervisor', async () => {
    mocks.mockIsDaemonRunningCurrentlyInstalledTalosVersion.mockResolvedValue(false)
    mocks.mockEnsureDaemonService.mockResolvedValue({ managed: true })
    await ensureDaemonRunning()
    expect(mocks.mockSpawnTalosCLI).not.toHaveBeenCalled()
    expect(mocks.mockCheckIfDaemonRunningAndCleanupStaleState).toHaveBeenCalled()
  })

  it('does not provision the service from a managed child session', async () => {
    process.env.TALOS_DAEMON_CHILD = '1'
    mocks.mockIsDaemonRunningCurrentlyInstalledTalosVersion.mockResolvedValue(true)
    await ensureDaemonRunning()
    expect(mocks.mockEnsureDaemonService).not.toHaveBeenCalled()
    expect(mocks.mockSpawnTalosCLI).not.toHaveBeenCalled()
  })

  it('waits for readiness after a service configuration change restarts a running daemon', async () => {
    mocks.mockIsDaemonRunningCurrentlyInstalledTalosVersion.mockResolvedValue(true)
    mocks.mockGetDaemonServiceStatus.mockReturnValue({ enabled: true, manager: 'launchd', active: true })
    mocks.mockEnsureDaemonService.mockResolvedValue({ managed: true, restarted: true })
    await ensureDaemonRunning()
    expect(mocks.mockCheckIfDaemonRunningAndCleanupStaleState).toHaveBeenCalled()
    expect(mocks.mockSpawnTalosCLI).not.toHaveBeenCalled()
  })

  it('returns without spawning when the daemon is already running', async () => {
    mocks.mockIsDaemonRunningCurrentlyInstalledTalosVersion.mockResolvedValue(true)

    await ensureDaemonRunning()

    expect(mocks.mockSpawnTalosCLI).not.toHaveBeenCalled()
    expect(mocks.mockCheckIfDaemonRunningAndCleanupStaleState).not.toHaveBeenCalled()
    expect(mocks.mockLoggerDebug).toHaveBeenCalledWith(
      'Ensuring Talos background service is running & matches our version...',
    )
  })

  it('starts the daemon and waits for readiness when the installed version is not running', async () => {
    const mockUnref = vi.fn()
    mocks.mockIsDaemonRunningCurrentlyInstalledTalosVersion.mockResolvedValue(false)
    mocks.mockSpawnTalosCLI.mockReturnValue({
      unref: mockUnref,
    })
    mocks.mockCheckIfDaemonRunningAndCleanupStaleState
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)

    await ensureDaemonRunning()

    expect(mocks.mockSpawnTalosCLI).toHaveBeenCalledWith(['daemon', 'start-sync'], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    })
    expect(mockUnref).toHaveBeenCalled()
    expect(mocks.mockCheckIfDaemonRunningAndCleanupStaleState).toHaveBeenCalledTimes(2)
    expect(mocks.mockLoggerDebug).toHaveBeenCalledWith('Starting Talos background service...')
    expect(mocks.mockLoggerDebug).toHaveBeenCalledWith('Talos background service is ready')
  })
})
