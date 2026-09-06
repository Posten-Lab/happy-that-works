import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fastify from 'fastify';
import type { Fastify } from '../types';
import { enableMonitoring } from './enableMonitoring';

const state = vi.hoisted(() => ({ query: vi.fn(), draining: false }));
vi.mock('@/storage/db', () => ({ db: { $queryRaw: state.query } }));
vi.mock('@/utils/shutdown', () => ({ isShutdown: () => state.draining }));
vi.mock('@/utils/log', () => ({ log: vi.fn() }));
vi.mock('@/app/monitoring/metrics2', () => ({
    httpRequestsCounter: { inc: vi.fn() },
    httpRequestDurationHistogram: { observe: vi.fn() },
    getMetricsLabelsFromRequest: () => ({}),
}));

const apps: ReturnType<typeof fastify>[] = [];
function createApp(checkRealtime = async (): Promise<void> => {}) {
    const app = fastify();
    apps.push(app);
    enableMonitoring(app as unknown as Fastify, checkRealtime, 25);
    return app;
}
beforeEach(() => {
    state.query.mockReset().mockResolvedValue([{ '?column?': 1 }]);
    state.draining = false;
});
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('dependency readiness', () => {
    it('requires both the database and realtime relay', async () => {
        const realtime = vi.fn(async () => {});
        const response = await createApp(realtime).inject('/health');
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ status: 'ok', service: 'talos-server' });
        expect(state.query).toHaveBeenCalledOnce();
        expect(realtime).toHaveBeenCalledOnce();
    });

    it.each(['database', 'realtime'])('returns 503 when %s fails without exposing the dependency error', async (dependency) => {
        const secretError = new Error('private connection information');
        if (dependency === 'database') state.query.mockRejectedValue(secretError);
        const response = await createApp(async () => {
            if (dependency === 'realtime') throw secretError;
        }).inject('/health');
        expect(response.statusCode).toBe(503);
        expect(response.body).not.toContain(secretError.message);
    });

    it('times out stalled dependencies without accumulating additional database queries', async () => {
        state.query.mockImplementation(() => new Promise(() => {}));
        const realtime = vi.fn(async () => { throw new Error('Redis is also unavailable'); });
        const app = createApp(realtime);
        expect((await app.inject('/health')).statusCode).toBe(503);
        expect((await app.inject('/health')).statusCode).toBe(503);
        expect(state.query).toHaveBeenCalledOnce();
        expect(realtime).toHaveBeenCalledOnce();
    });

    it('removes a draining server from service before contacting dependencies', async () => {
        state.draining = true;
        const response = await createApp().inject('/health');
        expect(response.statusCode).toBe(503);
        expect(response.json()).toMatchObject({ status: 'draining' });
        expect(state.query).not.toHaveBeenCalled();
    });

    it('does not report ready if shutdown starts during the database check', async () => {
        state.query.mockImplementation(async () => { state.draining = true; });
        const response = await createApp().inject('/health');
        expect(response.statusCode).toBe(503);
        expect(response.json()).toMatchObject({ status: 'draining' });
    });
});
