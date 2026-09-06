import { talosClient } from '@/talos/client'
import type {
    AuthState,
    Capability,
    Plugin,
    PluginContext,
} from '../types'
import type { TalosStateSnapshot } from '@/shared/talos-protocol'

function mapAuth(state: TalosStateSnapshot): AuthState {
    switch (state.status) {
        case 'authenticated':
            return { status: 'connected', account: state.accountId }
        case 'authenticating':
        case 'starting':
            return { status: 'connecting' }
        case 'error':
            return { status: 'error', message: state.error ?? 'Talos authentication failed' }
        case 'unconfigured':
            return { status: 'unconfigured' }
    }
}

class TalosPlugin implements Plugin {
    id = 'talos'
    name = 'Talos'
    description = 'Encrypted Talos account connection for future sync and remote session support.'
    vendor = 'Talos'
    category = 'integrations' as const
    accent = '#2563eb'

    private auth: AuthState = { status: 'connecting' }
    private capabilities: Capability[] = []
    private unsubscribe: (() => void) | null = null

    async activate(ctx: PluginContext) {
        talosClient.start()
        this.auth = mapAuth(talosClient.getSnapshot())
        this.unsubscribe = talosClient.subscribe(() => {
            this.auth = mapAuth(talosClient.getSnapshot())
            ctx.onAuthChanged()
        })
    }

    async connect(_credential: string, ctx: PluginContext): Promise<AuthState> {
        this.auth = { status: 'connecting' }
        ctx.onAuthChanged()
        const next = await talosClient.startLinkDevice()
        this.auth = mapAuth(next)
        ctx.onAuthChanged()
        return this.auth
    }

    async disconnect(ctx: PluginContext) {
        await talosClient.logout()
        this.auth = mapAuth(talosClient.getSnapshot())
        ctx.onAuthChanged()
    }

    getAuthState(): AuthState { return this.auth }
    getCapabilities(): readonly Capability[] { return this.capabilities }

    dispose(): void {
        this.unsubscribe?.()
        this.unsubscribe = null
    }
}

export const talosPlugin: Plugin = new TalosPlugin()
