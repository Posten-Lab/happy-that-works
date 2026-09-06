import { app, BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import type {
    TalosStateSnapshot,
    TalosWorkerMessage,
    TalosWorkerRequest,
    TalosWorkerRequestWithId,
} from '../../../shared/talos-protocol'
import { storageFilePath } from '../app-storage'

const __dirname = dirname(fileURLToPath(import.meta.url))

type PendingRequest = {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
}

const DEFAULT_SERVER_URL = 'http://localhost:3005'
const DEFAULT_WEBAPP_URL = 'http://localhost:8081'

let worker: Worker | null = null
let latestState: TalosStateSnapshot = {
    status: 'starting',
    serverUrl: process.env.TALOS_SERVER_URL || DEFAULT_SERVER_URL,
    webappUrl: process.env.TALOS_WEBAPP_URL || DEFAULT_WEBAPP_URL,
    clientReady: false,
    updatedAt: Date.now(),
}
const pending = new Map<string, PendingRequest>()

function workerEntryPath(): string {
    const p = join(__dirname, 'talos-worker.js')
    if (!existsSync(p)) {
        // eslint-disable-next-line no-console
        console.error('[talos-host] worker bundle missing at', p)
    }
    return p
}

function ensureWorker(): Worker {
    if (worker) return worker
    const w = new Worker(workerEntryPath(), {
        workerData: {
            storagePath: storageFilePath('talos-auth.json'),
            serverUrl: process.env.TALOS_SERVER_URL || DEFAULT_SERVER_URL,
            webappUrl: process.env.TALOS_WEBAPP_URL || DEFAULT_WEBAPP_URL,
            clientId: `talos/${app.getVersion() || '0.0.0'}`,
        },
    })
    w.on('message', (msg: TalosWorkerMessage) => {
        if (msg.kind === 'state') {
            latestState = msg.state
            broadcastState()
            return
        }
        if (msg.kind === 'response') {
            latestState = msg.state
            broadcastState()
            const entry = pending.get(msg.requestId)
            if (!entry) return
            pending.delete(msg.requestId)
            if (msg.ok) {
                entry.resolve({ state: msg.state, value: msg.value })
            } else {
                entry.reject(new Error(msg.error))
            }
            return
        }
        if (msg.kind === 'fatal') {
            // eslint-disable-next-line no-console
            console.error('[talos-worker] fatal:', msg.error)
        }
    })
    w.on('error', (err) => {
        // eslint-disable-next-line no-console
        console.error('[talos-worker] error:', err)
        failPending(err.message || 'Talos worker crashed')
        latestState = {
            ...latestState,
            status: 'error',
            clientReady: false,
            error: err.message || 'Talos worker crashed',
            updatedAt: Date.now(),
        }
        broadcastState()
        worker = null
    })
    w.on('exit', (code) => {
        if (code !== 0) {
            const message = `Talos worker exited with code ${code}`
            // eslint-disable-next-line no-console
            console.error('[talos-worker]', message)
            failPending(message)
            latestState = {
                ...latestState,
                status: 'error',
                clientReady: false,
                error: message,
                updatedAt: Date.now(),
            }
            broadcastState()
        }
        worker = null
    })
    worker = w
    return w
}

function failPending(reason: string): void {
    for (const entry of pending.values()) {
        entry.reject(new Error(reason))
    }
    pending.clear()
}

function broadcastState(): void {
    for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('talos:state', latestState)
    }
}

function sendRequest(request: TalosWorkerRequest): Promise<unknown> {
    const requestId = randomUUID()
    const msg: TalosWorkerRequestWithId = { ...request, requestId }
    const w = ensureWorker()
    return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject })
        w.postMessage(msg)
    })
}

export function registerTalosIpc(): void {
    ipcMain.handle('talos:state:get', async () => {
        const result = await sendRequest({ kind: 'getState' }) as { state: TalosStateSnapshot }
        return result.state
    })
    ipcMain.handle('talos:create-account', async () => {
        const result = await sendRequest({ kind: 'createAccount' }) as { state: TalosStateSnapshot }
        return result.state
    })
    ipcMain.handle('talos:start-link-device', async () => {
        const result = await sendRequest({ kind: 'startLinkDevice' }) as { state: TalosStateSnapshot }
        return result.state
    })
    ipcMain.handle('talos:restore-secret', async (_e, secretKey: string) => {
        const result = await sendRequest({ kind: 'restoreSecret', secretKey }) as { state: TalosStateSnapshot }
        return result.state
    })
    ipcMain.handle('talos:cancel-auth', async () => {
        const result = await sendRequest({ kind: 'cancelAuth' }) as { state: TalosStateSnapshot }
        return result.state
    })
    ipcMain.handle('talos:logout', async () => {
        const result = await sendRequest({ kind: 'logout' }) as { state: TalosStateSnapshot }
        return result.state
    })
    ipcMain.handle('talos:client-status', async () => {
        const result = await sendRequest({ kind: 'clientStatus' }) as {
            state: TalosStateSnapshot
            value?: unknown
        }
        return result.value
    })
    app.on('before-quit', () => {
        try {
            worker?.terminate()
        } catch {
            /* ignored */
        }
        worker = null
    })
}
