import type { Socket } from 'socket.io';
import { isShutdown } from '@/utils/shutdown';
import { log } from '@/utils/log';

/** Socket.IO closes transports without awaiting asynchronous event listeners. */
export class SocketWorkTracker {
    private readonly pending = new Set<Promise<void>>();
    private draining = false;

    constructor(private readonly shouldStop = isShutdown) {}

    private reject(socket: Socket, event: string, args: unknown[], message: string) {
        const ack = args.at(-1);
        if (typeof ack === 'function') {
            ack(event === 'rpc-call' || event === 'access-key-get'
                ? { ok: false, error: message, retryable: true }
                : { result: 'error', message, retryable: true });
        } else if (event === 'rpc-register' || event === 'rpc-unregister') {
            socket.emit('rpc-error', { type: event.slice(4), error: message });
        } else {
            socket.emit('error', { message, retryable: true });
        }
        // A transport close permits normal client reconnection; a namespace
        // disconnect would require the client to reconnect explicitly.
        socket.conn.close();
    }

    wrap(socket: Socket, event: string, listener: (...args: any[]) => unknown) {
        return (...args: any[]) => {
            if (this.draining || this.shouldStop()) {
                this.reject(socket, event, args, 'Server is shutting down; retry after reconnecting');
                return;
            }
            let finish!: () => void;
            const completed = new Promise<void>(resolve => { finish = resolve; });
            // Register before invoking the listener, including its synchronous
            // portion and work queued behind a session's receive-message lock.
            this.pending.add(completed);
            const settle = () => { this.pending.delete(completed); finish(); };
            const failed = () => {
                log({ module: 'websocket', level: 'error' }, `Socket handler failed: ${event}`);
                try { this.reject(socket, event, args, 'Server request failed; retry after reconnecting'); }
                catch { /* The transport may already have closed during the failed request. */ }
                finally { settle(); }
            };
            try { void Promise.resolve(listener.apply(socket, args)).then(settle, failed); }
            catch { failed(); }
        };
    }

    async drain(): Promise<void> {
        this.draining = true;
        await Promise.all([...this.pending]);
    }
}

/** Wrap only application handlers registered here, preserving lifecycle hooks. */
export function trackSocketHandlers(socket: Socket, work: SocketWorkTracker, register: () => void): void {
    const on = socket.on;
    socket.on = ((event: string, listener: (...args: any[]) => unknown) =>
        on.call(socket, event, work.wrap(socket, event, listener))) as typeof socket.on;
    try { register(); }
    finally { socket.on = on; }
}
