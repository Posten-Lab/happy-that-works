import { RpcHandlerManager } from "@/api/rpc/RpcHandlerManager";
import { logger } from "@/lib";
import { stopSessionRecovery } from '@/daemon/recovery/checkpoint';

interface KillSessionRequest {
    // No parameters needed
}

interface KillSessionResponse {
    success: boolean;
    message: string;
}


export function registerKillSessionHandler(
    rpcHandlerManager: RpcHandlerManager,
    killThisTalos: () => Promise<void>,
    sessionId: string,
) {
    rpcHandlerManager.registerHandler<KillSessionRequest, KillSessionResponse>('killSession', async () => {
        logger.debug('Kill session request received');
        // Record intent before any asynchronous provider cleanup. This works
        // even when the daemon or server is unavailable during shutdown.
        stopSessionRecovery(sessionId);

        // This will start the cleanup process
        void killThisTalos();

        // We should still be able to respond the the client, though they
        // should optimistically assume the session is dead.
        return {
            success: true,
            message: 'Killing talos-cli process'
        };
    });
}
