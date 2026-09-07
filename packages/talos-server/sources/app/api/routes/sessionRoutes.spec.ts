import fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Fastify } from '../types';

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock('@/storage/db', () => ({ db: { session: { findFirst } } }));
vi.mock('@/storage/seq', () => ({ allocateUserSeq: vi.fn() }));
vi.mock('@/app/events/eventRouter', () => ({ eventRouter: {}, buildNewSessionUpdate: vi.fn(), buildSessionActivityEphemeral: vi.fn() }));
vi.mock('@/app/session/sessionDelete', () => ({ sessionDelete: vi.fn() }));
vi.mock('@/utils/log', () => ({ log: vi.fn() }));
import { sessionRoutes } from './sessionRoutes';

describe('GET /v1/sessions/:sessionId', () => {
    let app: Fastify | undefined;
    afterEach(async () => { await app?.close(); vi.clearAllMocks(); });

    async function setup() {
        const instance = fastify();
        instance.setValidatorCompiler(validatorCompiler);
        instance.setSerializerCompiler(serializerCompiler);
        app = instance.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;
        app.decorate('authenticate', async (request: any, reply: any) => {
            if (!request.headers['x-user-id']) return reply.code(401).send({ error: 'Unauthorized' });
            request.userId = request.headers['x-user-id'];
        });
        sessionRoutes(app);
        await app.ready();
        return app;
    }

    it('returns inactive encrypted session metadata for its owner without exposing internal fields', async () => {
        const date = new Date('2026-09-01T00:00:00Z');
        findFirst.mockResolvedValue({
            id: 'session', seq: 7, createdAt: date, updatedAt: date, lastActiveAt: date,
            active: false, metadata: 'encrypted', metadataVersion: 3, agentState: null,
            agentStateVersion: 0, dataEncryptionKey: Buffer.from('key'), accountId: 'owner',
        });
        const server = await setup();
        const response = await server.inject({ method: 'GET', url: '/v1/sessions/session', headers: { 'x-user-id': 'owner' } });
        expect(response.statusCode).toBe(200);
        expect(findFirst.mock.calls[0][0].where).toEqual({ id: 'session', accountId: 'owner' });
        expect(response.json().session).toMatchObject({ active: false, metadata: 'encrypted', metadataVersion: 3, dataEncryptionKey: 'a2V5' });
        expect(response.json().session.accountId).toBeUndefined();
    });

    it('returns 404 for a missing or other-account session', async () => {
        findFirst.mockResolvedValue(null);
        const server = await setup();
        const response = await server.inject({ method: 'GET', url: '/v1/sessions/other', headers: { 'x-user-id': 'owner' } });
        expect(response.statusCode).toBe(404);
        expect(findFirst.mock.calls[0][0].where).toEqual({ id: 'other', accountId: 'owner' });
    });

    it('requires authentication before reading a session', async () => {
        const server = await setup();
        const response = await server.inject({ method: 'GET', url: '/v1/sessions/session' });
        expect(response.statusCode).toBe(401);
        expect(findFirst).not.toHaveBeenCalled();
    });
});
