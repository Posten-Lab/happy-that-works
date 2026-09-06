import { afterEach, describe, expect, it, vi } from 'vitest';
import fastify from 'fastify';
import { ShutdownCoordinator } from './shutdown';

vi.mock('./log', () => ({ log: vi.fn() }));

function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}

afterEach(() => vi.useRealTimers());

describe('ordered graceful shutdown', () => {
    it('keeps the database open until a real in-flight HTTP response and pending work finish', async () => {
        const coordinator = new ShutdownCoordinator();
        const requestStarted = deferred();
        const finishRequest = deferred();
        const workStarted = deferred();
        const finishWork = deferred();
        let databaseOpen = true;
        const app = fastify();
        app.get('/request', async () => {
            requestStarted.resolve();
            await finishRequest.promise;
            return { databaseOpen };
        });
        await app.listen({ host: '127.0.0.1', port: 0 });
        const address = app.server.address();
        if (!address || typeof address === 'string') throw new Error('Missing test address');
        coordinator.register('database', async () => { databaseOpen = false; });
        coordinator.register('http', async () => { await app.close(); }, { phase: 'transport' });
        coordinator.register('pending-work', async () => {
            workStarted.resolve();
            await finishWork.promise;
            expect(databaseOpen).toBe(true);
        }, { phase: 'work' });
        try {
            const response = fetch(`http://127.0.0.1:${address.port}/request`);
            await requestStarted.promise;
            const stopping = coordinator.shutdown();
            expect(coordinator.controller.signal.aborted).toBe(true);
            expect(databaseOpen).toBe(true);
            finishRequest.resolve();
            expect(await (await response).json()).toEqual({ databaseOpen: true });
            await workStarted.promise;
            expect(databaseOpen).toBe(true);
            finishWork.resolve();
            await stopping;
            expect(databaseOpen).toBe(false);
        } finally {
            finishRequest.resolve();
            finishWork.resolve();
            await app.close();
        }
    });

    it('closes HTTP and websocket transports together before resource cleanup', async () => {
        const coordinator = new ShutdownCoordinator();
        const socketClosed = deferred();
        const events: string[] = [];
        coordinator.register('http', async () => {
            await socketClosed.promise;
            events.push('http');
        }, { phase: 'transport' });
        coordinator.register('socket', async () => {
            events.push('socket');
            socketClosed.resolve();
        }, { phase: 'transport' });
        coordinator.register('database', async () => { events.push('database'); });
        await coordinator.shutdown();
        expect(events).toEqual(['socket', 'http', 'database']);
    });

    it('bounds a stalled drain without closing resources underneath pending requests', async () => {
        vi.useFakeTimers();
        const coordinator = new ShutdownCoordinator();
        const disconnect = vi.fn(async () => {});
        coordinator.register('stalled-request', () => new Promise(() => {}), { phase: 'transport' });
        coordinator.register('database', disconnect);
        let finished = false;
        const stopping = coordinator.shutdown(100).then(() => { finished = true; });
        await vi.advanceTimersByTimeAsync(99);
        expect(finished).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await stopping;
        expect(finished).toBe(true);
        expect(disconnect).not.toHaveBeenCalled();
    });

    it('continues cleanup after synchronous handler failures and runs only once', async () => {
        const coordinator = new ShutdownCoordinator();
        const disconnect = vi.fn(async () => {});
        const removed = vi.fn(async () => {});
        coordinator.register('removed', removed)();
        coordinator.register('broken', () => { throw new Error('failed'); }, { phase: 'transport' });
        coordinator.register('database', disconnect);
        const stopping = coordinator.shutdown();
        expect(coordinator.shutdown()).toBe(stopping);
        await stopping;
        expect(disconnect).toHaveBeenCalledTimes(1);
        expect(removed).not.toHaveBeenCalled();
    });
});
