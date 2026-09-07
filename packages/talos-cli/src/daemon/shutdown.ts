export type DaemonShutdownSource = 'talos-app' | 'talos-cli' | 'os-signal' | 'exception';
type ShutdownRequest = { source: DaemonShutdownSource; errorMessage?: string };

/** Persist explicit stop intent before cleanup can block on the network. */
export function createDaemonShutdownController(options: {
    managed: boolean;
    pauseService: () => void;
    onRequest: (request: ShutdownRequest) => void;
    forceExit: () => void;
}) {
    let resolve!: (request: ShutdownRequest) => void;
    let requested = false;
    const resolvesWhenShutdownRequested = new Promise<ShutdownRequest>(done => { resolve = done; });
    const requestShutdown = (source: DaemonShutdownSource, errorMessage?: string) => {
        if (options.managed && (source === 'talos-app' || source === 'talos-cli')) options.pauseService();
        if (requested) return;
        requested = true;
        const request = { source, errorMessage };
        options.onRequest(request);
        setTimeout(options.forceExit, 1000);
        resolve(request);
    };
    return { requestShutdown, resolvesWhenShutdownRequested };
}
