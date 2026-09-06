export type TalosAuthStatus =
    | 'starting'
    | 'unconfigured'
    | 'authenticating'
    | 'authenticated'
    | 'error'

export type TalosAuthMethod = 'link-device' | 'create-account' | 'restore-secret'

export interface TalosAuthFlowSnapshot {
    method: TalosAuthMethod
    authUrl?: string
    publicKey?: string
    startedAt: number
}

export interface TalosStateSnapshot {
    status: TalosAuthStatus
    serverUrl: string
    webappUrl: string
    clientReady: boolean
    accountId?: string
    tokenExpiresAt?: number
    authFlow?: TalosAuthFlowSnapshot
    error?: string
    updatedAt: number
}

export interface TalosAuthenticatedClientStatus {
    ready: boolean
    serverUrl: string
    accountId?: string
    anonId?: string
    contentPublicKey?: string
}

export type TalosWorkerRequest =
    | { kind: 'getState' }
    | { kind: 'createAccount' }
    | { kind: 'startLinkDevice' }
    | { kind: 'restoreSecret'; secretKey: string }
    | { kind: 'cancelAuth' }
    | { kind: 'logout' }
    | { kind: 'clientStatus' }

export type TalosWorkerRequestWithId = TalosWorkerRequest & { requestId: string }

export type TalosWorkerResponse =
    | {
          kind: 'response'
          requestId: string
          ok: true
          state: TalosStateSnapshot
          value?: unknown
      }
    | {
          kind: 'response'
          requestId: string
          ok: false
          state: TalosStateSnapshot
          error: string
      }

export type TalosWorkerStateMessage = {
    kind: 'state'
    state: TalosStateSnapshot
}

export type TalosWorkerFatalMessage = {
    kind: 'fatal'
    error: string
}

export type TalosWorkerMessage =
    | TalosWorkerResponse
    | TalosWorkerStateMessage
    | TalosWorkerFatalMessage
