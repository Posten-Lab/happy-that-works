/**
 * HTTP client helpers for daemon communication
 * Used by CLI commands to interact with running daemon
 */

import { logger } from '@/ui/logger';
import { clearDaemonState, readDaemonState, type DaemonLocallyPersistedState } from '@/persistence';
import { Metadata } from '@/api/types';
import { configuration } from '@/configuration';
import { readFileSync, statSync } from 'node:fs';
import { getProcessIdentity, getProcessStartTime } from '@/utils/processIdentity';

/** Unknown ownership must never authorize a signal or removal of a live owner's state. */
function inspectDaemonOwner(state: DaemonLocallyPersistedState): { identity?: string; stale: boolean } {
  if (!Number.isSafeInteger(state.pid) || state.pid <= 0) return { stale: true };
  const identity = getProcessIdentity(state.pid);
  if (!identity) {
    try { process.kill(state.pid, 0); }
    catch (error) { return { stale: (error as NodeJS.ErrnoException).code === 'ESRCH' }; }
    return { stale: false };
  }
  if (state.processIdentity) {
    return identity === state.processIdentity ? { identity, stale: false } : { stale: true };
  }
  // Legacy state had no birth identity. Its file predates any PID reuse after
  // reboot. Capture the verified current birth now and recheck it before killing.
  try {
    const current = JSON.parse(readFileSync(configuration.daemonStateFile, 'utf8')) as DaemonLocallyPersistedState;
    if (current.pid !== state.pid || current.startTime !== state.startTime || current.processIdentity !== state.processIdentity) {
      return { stale: false };
    }
    const startedAt = getProcessStartTime(state.pid);
    if (startedAt === null) return { stale: false };
    if (startedAt > statSync(configuration.daemonStateFile).mtimeMs + 1000) return { stale: true };
    return { identity, stale: false };
  } catch { return { stale: false }; }
}

async function daemonPost(path: string, body?: any, owner?: { state: DaemonLocallyPersistedState; identity: string }): Promise<{ error?: string } | any> {
  const state = owner?.state ?? await readDaemonState();
  if (!state?.httpPort) {
    const errorMessage = 'No daemon running, no state file found';
    logger.debug(`[CONTROL CLIENT] ${errorMessage}`);
    return {
      error: errorMessage
    };
  }

  const identity = owner?.identity ?? inspectDaemonOwner(state).identity;
  if (!identity || getProcessIdentity(state.pid) !== identity) {
    const errorMessage = 'Daemon process ownership could not be verified';
    logger.debug(`[CONTROL CLIENT] ${errorMessage}`);
    return {
      error: errorMessage
    };
  }

  try {
    const timeout = process.env.TALOS_DAEMON_HTTP_TIMEOUT ? parseInt(process.env.TALOS_DAEMON_HTTP_TIMEOUT) : 10_000;
    const response = await fetch(`http://127.0.0.1:${state.httpPort}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      // Mostly increased for stress test
      signal: AbortSignal.timeout(timeout)
    });
    
    if (!response.ok) {
      const errorMessage = `Request failed: ${path}, HTTP ${response.status}`;
      logger.debug(`[CONTROL CLIENT] ${errorMessage}`);
      return {
        error: errorMessage
      };
    }
    
    return await response.json();
  } catch (error) {
    const errorMessage = `Request failed: ${path}, ${error instanceof Error ? error.message : 'Unknown error'}`;
    logger.debug(`[CONTROL CLIENT] ${errorMessage}`);
    return {
      error: errorMessage
    }
  }
}

const SESSION_STARTED_RETRY_TIMEOUT_MS = 3000;
const SESSION_STARTED_RETRY_INTERVAL_MS = 100;

export async function notifyDaemonSessionStarted(
  sessionId: string,
  metadata: Metadata,
  encryption?: {
    encryptionKey: string;
    encryptionVariant: 'legacy' | 'dataKey';
    seq: number;
    metadataVersion: number;
    agentStateVersion: number;
  }
): Promise<{ error?: string } | any> {
  // Retry briefly — ensureDaemonRunning already waits for readiness, but we may
  // race a daemon that is mid-restart (version upgrade, crash recovery). Without
  // this, the session's encryption data never reaches the daemon and the mobile
  // app's resume-talos-session RPC fails with "not tracked by this daemon".
  const payload = { sessionId, metadata, encryption };
  const deadline = Date.now() + SESSION_STARTED_RETRY_TIMEOUT_MS;
  let result: { error?: string } | any;

  while (true) {
    result = await daemonPost('/session-started', payload);
    if (!result?.error) {
      return result;
    }
    if (Date.now() >= deadline) {
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, SESSION_STARTED_RETRY_INTERVAL_MS));
  }
}

export async function listDaemonSessions(): Promise<any[]> {
  const result = await daemonPost('/list');
  return result.children || [];
}

export async function stopDaemonSession(sessionId: string): Promise<boolean> {
  const result = await daemonPost('/stop-session', { sessionId });
  return result.success || false;
}

export async function spawnDaemonSession(directory: string, sessionId?: string): Promise<any> {
  const result = await daemonPost('/spawn-session', { directory, sessionId });
  return result;
}

export async function stopDaemonHttp(): Promise<void> {
  await daemonPost('/stop');
}

/** Verify process ownership and HTTP readiness without releasing a live owner's lock. */
export async function checkIfDaemonRunningAndCleanupStaleState(): Promise<boolean> {
  const state = await readDaemonState();
  if (!state) {
    return false;
  }

  const owner = inspectDaemonOwner(state);
  if (!owner.identity) {
    if (owner.stale) await cleanupDaemonState(state);
    return false;
  }

  // HTTP readiness is separate from process ownership. A slow live owner keeps
  // its state and lock even when the readiness check times out.
  if (state.httpPort) {
    try {
      const response = await fetch(`http://127.0.0.1:${state.httpPort}/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(2000)
      });
      if (response.ok) {
        return getProcessIdentity(state.pid) === owner.identity;
      }
    } catch {
      logger.debug(`[DAEMON RUN] Daemon PID ${state.pid} did not answer its health check; retaining process ownership`);
    }
    return false;
  }

  return false;
}

/**
 * Check if the running daemon version matches the current CLI version.
 * This should work from both the daemon itself & a new CLI process.
 * Works via the daemon.state.json file.
 * 
 * @returns true if versions match, false if versions differ or no daemon running
 */
export async function isDaemonRunningCurrentlyInstalledTalosVersion(): Promise<boolean> {
  logger.debug('[DAEMON CONTROL] Checking if daemon is running same version');
  const runningDaemon = await checkIfDaemonRunningAndCleanupStaleState();
  if (!runningDaemon) {
    logger.debug('[DAEMON CONTROL] No daemon running, returning false');
    return false;
  }

  const state = await readDaemonState();
  if (!state) {
    logger.debug('[DAEMON CONTROL] No daemon state found, returning false');
    return false;
  }
  
  // Compare the running daemon's recorded version against THIS CLI invocation's
  // bundled version. Both are read from the same source of truth: the `version`
  // field baked into `dist/` at build time via `import packageJson from '../package.json'`.
  //
  // Previously we read `package.json` fresh from disk on every check, but that
  // produced infinite restart loops (#1107) when `package.json.version` diverged
  // from the bundled version — e.g. when `talos-coder@0.13.1` was published as
  // a deprecation stub that bumped the manifest without rebuilding `dist/`.
  // The daemon would write its bundled version (0.13.0), read 0.13.1 from disk,
  // detect a mismatch, self-restart, and the new daemon would repeat the cycle.
  //
  // Using `configuration.currentCliVersion` instead guarantees the writer and
  // reader agree whenever they're executing the same `dist/` bundle, and still
  // correctly detects real npm upgrades (the new bundle has a new baked version).
  const currentCliVersion = configuration.currentCliVersion;
  logger.debug(`[DAEMON CONTROL] Current CLI version: ${currentCliVersion}, Daemon started with version: ${state.startedWithCliVersion}`);
  return currentCliVersion === state.startedWithCliVersion;
}

export async function cleanupDaemonState(expected?: DaemonLocallyPersistedState): Promise<void> {
  try {
    await clearDaemonState(expected);
    logger.debug('[DAEMON RUN] Daemon state file removed');
  } catch (error) {
    logger.debug('[DAEMON RUN] Error cleaning up daemon metadata', error);
  }
}

export async function stopDaemon() {
  try {
    const state = await readDaemonState();
    if (!state) {
      logger.debug('No daemon state found');
      return;
    }

    const owner = inspectDaemonOwner(state);
    if (!owner.identity) {
      logger.debug('Daemon stop skipped because process ownership could not be verified');
      if (owner.stale) await cleanupDaemonState(state);
      return;
    }
    logger.debug(`Stopping daemon with PID ${state.pid}`);

    // Try HTTP graceful stop
    try {
      await daemonPost('/stop', undefined, { state, identity: owner.identity });

      // Wait for daemon to die
      await waitForProcessDeath(state.pid, owner.identity, 2000);
      logger.debug('Daemon stopped gracefully via HTTP');
      return;
    } catch (error) {
      logger.debug('HTTP stop failed, will force kill', error);
    }

    // Force kill
    try {
      if (getProcessIdentity(state.pid) !== owner.identity) return;
      process.kill(state.pid, 'SIGKILL');
      logger.debug('Force killed daemon');
    } catch (error) {
      logger.debug('Daemon already dead');
    }
  } catch (error) {
    logger.debug('Error stopping daemon', error);
  }
}

async function waitForProcessDeath(pid: number, identity: string, timeout: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (getProcessIdentity(pid) !== identity) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Process did not die within timeout');
}
