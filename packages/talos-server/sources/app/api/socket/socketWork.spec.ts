import { describe, expect, it, vi } from 'vitest';
import fastify from 'fastify';
import { Server, type Socket } from 'socket.io';
import { ShutdownCoordinator } from '@/utils/shutdown';
import { SocketWorkTracker, trackSocketHandlers } from './socketWork';

vi.mock('@/utils/log', () => ({ log: vi.fn() }));

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}

async function harness(register: (socket: Socket) => void, shouldStop?: () => boolean) {
    const coordinator = new ShutdownCoordinator();
    const work = new SocketWorkTracker(shouldStop || (() => coordinator.controller.signal.aborted));
    const app = fastify();
    const io = new Server(app.server);
    const connected = deferred();
    io.on('connection', socket => {
        trackSocketHandlers(socket, work, () => register(socket));
        connected.resolve();
    });
    coordinator.register('http', async () => { await app.close(); }, { phase: 'transport' });
    coordinator.register('socket', async () => {
        await new Promise<void>(resolve => io.close(() => resolve()));
        await work.drain();
    }, { phase: 'transport' });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    const endpoint = `http://127.0.0.1:${address.port}/socket.io/?EIO=4&transport=polling`;
    // A real Engine.IO/Socket.IO polling client, using only Node's HTTP API.
    const handshake = await (await fetch(endpoint)).text();
    const sid = JSON.parse(handshake.slice(1)).sid;
    const url = `${endpoint}&sid=${sid}`;
    // Node's runtime signal is valid; shared native ambient declarations give
    // fetch a different AbortSignal type in this monorepo.
    const timeoutSignal = () => AbortSignal.timeout(2000) as unknown as NonNullable<Parameters<typeof fetch>[1]>['signal'];
    const post = async (packet: string) => {
        const response = await fetch(url, { method: 'POST', body: packet,
            headers: { 'content-type': 'text/plain' }, signal: timeoutSignal() });
        expect(response.status).toBe(200);
    };
    const poll = async () => (await fetch(url, { signal: timeoutSignal() })).text();
    await post('40'); // Connect the Socket.IO namespace.
    await connected.promise;
    expect(await poll()).toMatch(/^40/);
    return { coordinator, work, post, poll, async close() {
        await new Promise<void>(resolve => io.close(() => resolve()));
        await work.drain();
        await app.close();
    } };
}

describe('accepted Socket.IO work during shutdown', () => {
    it('persists an accepted message before activity flush, database cleanup, and shutdown completion', async () => {
        const accepted = deferred();
        const allowWrite = deferred();
        let databaseOpen = true;
        const events: string[] = [];
        const h = await harness(socket => {
            socket.on('message', async () => {
                accepted.resolve();
                await allowWrite.promise;
                expect(databaseOpen).toBe(true);
                events.push('message-persisted');
            });
        });
        h.coordinator.register('activity-cache', async () => { events.push('activity-flushed'); }, { phase: 'work' });
        h.coordinator.register('database', async () => { databaseOpen = false; events.push('database-closed'); });
        try {
            await h.post('42["message",{"message":"synthetic encrypted content"}]');
            await accepted.promise;
            let stopped = false;
            const stopping = h.coordinator.shutdown().then(() => { stopped = true; });
            await new Promise(resolve => setTimeout(resolve, 20));
            expect(stopped).toBe(false);
            expect(events).toEqual([]);
            expect(databaseOpen).toBe(true);
            allowWrite.resolve();
            await stopping;
            expect(events).toEqual(['message-persisted', 'activity-flushed', 'database-closed']);
        } finally { allowWrite.resolve(); await h.close(); }
    });

    it.each(['rpc-call', 'access-key-get', 'update-state'])('rejects new %s work with the existing error-ack envelope', async event => {
        let draining = false;
        const handler = vi.fn();
        const h = await harness(socket => { socket.on(event, handler); }, () => draining);
        try {
            draining = true;
            await h.post(`421${JSON.stringify([event, {}])}`);
            const packets = (await h.poll()).split('\u001e');
            const ack = packets.find(packet => packet.startsWith('431'));
            expect(ack).toBeDefined();
            const [response] = JSON.parse(ack!.slice(3));
            expect(response).toMatchObject(event === 'update-state'
                ? { result: 'error', retryable: true }
                : { ok: false, retryable: true });
            expect(response.message || response.error).toContain('retry after reconnecting');
            expect(handler).not.toHaveBeenCalled();
        } finally { await h.close(); }
    });

    it('reports a rejected unacknowledged message instead of silently accepting it', async () => {
        let draining = false;
        const handler = vi.fn();
        const h = await harness(socket => { socket.on('message', handler); }, () => draining);
        try {
            draining = true;
            await h.post('42["message",{}]');
            const packets = (await h.poll()).split('\u001e');
            const failure = packets.find(packet => packet.startsWith('42["error"'));
            expect(failure).toBeDefined();
            expect(JSON.parse(failure!.slice(2))[1]).toMatchObject({ retryable: true });
            expect(handler).not.toHaveBeenCalled();
        } finally { await h.close(); }
    });

    it.each(['synchronous', 'asynchronous'])('settles failed %s handlers so shutdown can complete', async failure => {
        const h = await harness(socket => {
            socket.on('update-state', () => {
                if (failure === 'synchronous') throw new Error('synthetic failure');
                return Promise.reject(new Error('synthetic failure'));
            });
        });
        const cleanup = vi.fn(async () => {});
        h.coordinator.register('database', cleanup);
        try {
            await h.post('421["update-state",{}]');
            const ack = (await h.poll()).split('\u001e').find(packet => packet.startsWith('431'));
            expect(JSON.parse(ack!.slice(3))[0]).toMatchObject({ result: 'error', retryable: true });
            await h.coordinator.shutdown();
            expect(cleanup).toHaveBeenCalledOnce();
        } finally { await h.close(); }
    });
});
