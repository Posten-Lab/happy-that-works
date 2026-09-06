import { log } from "./log";

type ShutdownPhase = 'transport' | 'work' | 'resources';
type ShutdownOptions = { phase?: ShutdownPhase };

/** Drain requests and pending work while their database and Redis remain usable. */
export class ShutdownCoordinator {
    readonly controller = new AbortController();
    private handlers = new Set<{ name: string; callback: () => Promise<void>; phase: ShutdownPhase }>();
    private running?: Promise<void>;

    register(name: string, callback: () => Promise<void>, options: ShutdownOptions = {}): () => void {
        if (this.controller.signal.aborted) {
            void Promise.resolve().then(callback).catch(() => log(`Late shutdown handler failed: ${name}`));
            return () => {};
        }
        const handler = { name, callback, phase: options.phase ?? 'resources' };
        this.handlers.add(handler);
        return () => { this.handlers.delete(handler); };
    }

    shutdown(timeoutMs = 45_000): Promise<void> {
        if (!this.running) this.running = this.drain(timeoutMs);
        return this.running;
    }

    private async drain(timeoutMs: number): Promise<void> {
        this.controller.abort();
        const handlers = [...this.handlers];
        this.handlers.clear();
        let timer: ReturnType<typeof setTimeout>;
        const deadline = new Promise<false>((resolve) => {
            timer = setTimeout(() => resolve(false), timeoutMs);
        });
        try {
            for (const phase of ['transport', 'work', 'resources'] as const) {
                const completed = await Promise.race([
                    Promise.all(handlers.filter((handler) => handler.phase === phase).map(async (handler) => {
                        try { await handler.callback(); }
                        catch { log(`Shutdown handler failed: ${handler.name}`); }
                    })).then(() => true),
                    deadline,
                ]);
                if (!completed) {
                    // The process owner exits after this promise settles. Do not
                    // disconnect resources under requests that failed to drain.
                    log(`Shutdown deadline reached while draining ${phase}`);
                    return;
                }
            }
        } finally {
            clearTimeout(timer!);
        }
    }
}

const coordinator = new ShutdownCoordinator();
export const shutdownSignal = coordinator.controller.signal;

export function onShutdown(name: string, callback: () => Promise<void>, options: ShutdownOptions = {}): () => void {
    return coordinator.register(name, callback, options);
}

export function isShutdown() {
    return shutdownSignal.aborted;
}

export async function awaitShutdown() {
    await new Promise<void>((resolve) => {
        const handleSignal = () => {
            process.off('SIGINT', handleSignal);
            process.off('SIGTERM', handleSignal);
            resolve();
        };
        process.once('SIGINT', handleSignal);
        process.once('SIGTERM', handleSignal);
    });
    await coordinator.shutdown();
}

export async function keepAlive<T>(name: string, callback: () => Promise<T>): Promise<T> {
    if (shutdownSignal.aborted) throw new Error('Server is shutting down');
    let completed = false;
    let result: T;
    let error: any;
    
    const promise = new Promise<void>((resolve) => {
        const unsubscribe = onShutdown(`keepAlive:${name}`, async () => {
            if (!completed) {
                log(`Waiting for keepAlive operation to complete: ${name}`);
                await promise;
            }
        }, { phase: 'work' });
        
        // Run the callback
        callback().then(
            (res) => {
                result = res;
                completed = true;
                unsubscribe();
                resolve();
            },
            (err) => {
                error = err;
                completed = true;
                unsubscribe();
                resolve();
            }
        );
    });
    
    // Wait for completion
    await promise;
    
    if (error) {
        throw error;
    }
    
    return result!;
}
