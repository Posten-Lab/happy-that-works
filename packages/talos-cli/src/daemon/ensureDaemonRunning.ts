import { logger } from '@/ui/logger'
import { checkIfDaemonRunningAndCleanupStaleState, isDaemonRunningCurrentlyInstalledTalosVersion, stopDaemon } from './controlClient'
import { spawnTalosCLI } from '@/utils/spawnTalosCLI'
import { ensureDaemonService, getDaemonServiceStatus } from './service'

const DAEMON_READY_TIMEOUT_MS = 5000
const DAEMON_READY_POLL_INTERVAL_MS = 100

export async function ensureDaemonRunning(): Promise<void> {
  logger.debug('Ensuring Talos background service is running & matches our version...')

  let running = await isDaemonRunningCurrentlyInstalledTalosVersion()
  let managed = false
  // A daemon child must not reinstall or restart its own parent.
  if (process.env.TALOS_SERVICE_MANAGED === '1' || process.env.TALOS_DAEMON_CHILD === '1') {
    if (running) return
    managed = true
  } else {
    try {
      const status = getDaemonServiceStatus()
      if (running && status.enabled && status.manager && !status.active) {
        // Adopt the previous detached daemon under the OS supervisor. Its coding
        // sessions survive shutdown and are reconciled by the new daemon.
        await stopDaemon()
        running = false
      }
      const result = await ensureDaemonService({ restart: !running })
      managed = result.managed
      if (result.restarted) running = false
      if (result.message) console.warn(`Talos: ${result.message}`)
    } catch (error) {
      console.warn(`Talos automatic background startup could not be configured: ${error instanceof Error ? error.message : String(error)}. Setup will retry on your next login; this daemon cannot be relied on to survive reboot.`)
    }
  }

  if (running) return

  logger.debug('Starting Talos background service...')

  if (!managed) {
    const daemonProcess = spawnTalosCLI(['daemon', 'start-sync'], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    })
    daemonProcess.unref()
  }

  // Wait for the spawned daemon to be fully ready: it must write daemon.state.json,
  // bind its HTTP port, and respond to a health ping. Without this, early callers
  // (e.g. notifyDaemonSessionStarted) race the daemon startup and the webhook is
  // silently lost — which later breaks resume-talos-session.
  const deadline = Date.now() + DAEMON_READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await checkIfDaemonRunningAndCleanupStaleState()) {
      logger.debug('Talos background service is ready')
      return
    }
    await new Promise(resolve => setTimeout(resolve, DAEMON_READY_POLL_INTERVAL_MS))
  }

  logger.debug(`Talos background service did not become ready within ${DAEMON_READY_TIMEOUT_MS}ms; continuing anyway`)
}
