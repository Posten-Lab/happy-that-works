import { useSyncExternalStore } from 'react'
import type {
    TalosAuthenticatedClientStatus,
    TalosStateSnapshot,
} from '@/shared/talos-protocol'

const initialState: TalosStateSnapshot = {
    status: 'starting',
    serverUrl: '',
    webappUrl: '',
    clientReady: false,
    updatedAt: Date.now(),
}

let snapshot = initialState
let unsubscribeIpc: (() => void) | null = null
let initialized = false
const listeners = new Set<() => void>()

function emit(next: TalosStateSnapshot): void {
    snapshot = next
    for (const listener of listeners) listener()
}

function setError(message: string): void {
    emit({
        ...snapshot,
        status: 'error',
        error: message,
        updatedAt: Date.now(),
    })
}

function ensureStarted(): void {
    if (initialized) return
    initialized = true
    try {
        unsubscribeIpc = window.talos.onState(emit)
        void window.talos.getState().then(emit).catch((err) => {
            setError(err instanceof Error ? err.message : String(err))
        })
    } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
    }
}

export const talosClient = {
    start(): void {
        ensureStarted()
    },
    getSnapshot(): TalosStateSnapshot {
        return snapshot
    },
    subscribe(listener: () => void): () => void {
        ensureStarted()
        listeners.add(listener)
        return () => {
            listeners.delete(listener)
            if (listeners.size === 0 && unsubscribeIpc) {
                unsubscribeIpc()
                unsubscribeIpc = null
                initialized = false
            }
        }
    },
    async createAccount(): Promise<TalosStateSnapshot> {
        ensureStarted()
        const next = await window.talos.createAccount()
        emit(next)
        return next
    },
    async startLinkDevice(): Promise<TalosStateSnapshot> {
        ensureStarted()
        const next = await window.talos.startLinkDevice()
        emit(next)
        return next
    },
    async restoreSecret(secretKey: string): Promise<TalosStateSnapshot> {
        ensureStarted()
        const next = await window.talos.restoreSecret(secretKey)
        emit(next)
        return next
    },
    async cancelAuth(): Promise<TalosStateSnapshot> {
        ensureStarted()
        const next = await window.talos.cancelAuth()
        emit(next)
        return next
    },
    async logout(): Promise<TalosStateSnapshot> {
        ensureStarted()
        const next = await window.talos.logout()
        emit(next)
        return next
    },
    async clientStatus(): Promise<TalosAuthenticatedClientStatus> {
        ensureStarted()
        return window.talos.clientStatus()
    },
}

export function useTalosState(): TalosStateSnapshot {
    return useSyncExternalStore(
        talosClient.subscribe,
        talosClient.getSnapshot,
        talosClient.getSnapshot,
    )
}
