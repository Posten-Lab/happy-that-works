import { db } from "@/storage/db";
import { Fastify } from "../types";
import { httpRequestsCounter, httpRequestDurationHistogram, getMetricsLabelsFromRequest } from "@/app/monitoring/metrics2";
import { log } from "@/utils/log";
import { isShutdown } from "@/utils/shutdown";

export function enableMonitoring(app: Fastify, checkRealtime = async (): Promise<void> => {}, timeoutMs = 2500) {
    // Reuse an unresolved dependency check, rather than accumulating queries
    // during an outage. Each HTTP request still has its own short deadline.
    let pendingReadiness: Promise<void> | undefined;
    // Add metrics hooks
    app.addHook('onRequest', async (request, reply) => {
        request.startTime = Date.now();
    });

    app.addHook('onResponse', async (request, reply) => {
        const duration = (Date.now() - (request.startTime || Date.now())) / 1000;
        const method = request.method;
        // Use routeOptions.url for the route template, fallback to parsed URL path
        const route = request.routeOptions?.url || request.url.split('?')[0] || 'unknown';
        const status = reply.statusCode.toString();
        const labels = getMetricsLabelsFromRequest(request);

        // Increment request counter
        httpRequestsCounter.inc({ method, route, status, ...labels });

        // Record request duration
        httpRequestDurationHistogram.observe({ method, route, status, ...labels }, duration);
    });

    app.get('/health', async (request, reply) => {
        if (isShutdown()) return reply.code(503).send({ status: 'draining', service: 'talos-server' });
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            if (!pendingReadiness) {
                const check = Promise.allSettled([db.$queryRaw`SELECT 1`, checkRealtime()]).then((results) => {
                    if (results.some((result) => result.status === 'rejected')) throw new Error('Dependency unavailable');
                });
                pendingReadiness = check;
                void check.then(() => { pendingReadiness = undefined; }, () => { pendingReadiness = undefined; });
            }
            await Promise.race([
                pendingReadiness,
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new Error('Readiness timed out')), timeoutMs);
                }),
            ]);
            if (isShutdown()) return reply.code(503).send({ status: 'draining', service: 'talos-server' });
            reply.send({
                status: 'ok',
                timestamp: new Date().toISOString(),
                service: 'talos-server'
            });
        } catch (error) {
            log({ module: 'health', level: 'error' }, 'Dependency readiness check failed');
            reply.code(503).send({
                status: 'error',
                timestamp: new Date().toISOString(),
                service: 'talos-server',
                error: 'Dependency connectivity failed'
            });
        } finally {
            if (timer) clearTimeout(timer);
        }
    });
}
