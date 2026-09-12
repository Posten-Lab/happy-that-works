import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Fastify } from '../types';

vi.hoisted(() => {
    vi.stubEnv('DB_PROVIDER', 'pglite');
    vi.stubEnv('PGLITE_DIR', 'memory://');
    vi.stubEnv('TALOS_MASTER_SECRET', 'session-search-http-integration-fixture');
    vi.stubEnv('S3_HOST', '');
});

import { auth } from '@/app/auth/auth';
import { db, getPGlite } from '@/storage/db';
import { logger } from '@/utils/log';
import { enableAuthentication } from '../utils/enableAuthentication';
import { sessionRoutes } from './sessionRoutes';
import { v3SessionRoutes } from './v3SessionRoutes';

const now = new Date('2026-09-12T12:00:00.000Z');
const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
const older = new Date(cutoff.getTime() - 1);
const recentIds = Array.from({ length: 205 }, (_, index) => `recent-${String(index).padStart(3, '0')}`);

type ListedSession = { id: string; active: boolean; lastMessageAt: number | null; metadata: string; updatedAt: number };
type SessionPage = { sessions: ListedSession[]; nextCursor: string | null; hasNext: boolean };

describe('session search history over authenticated HTTP and PGlite', () => {
    let app: Fastify;
    let baseUrl: string;
    let ownerToken: string;
    let otherToken: string;

    beforeAll(async () => {
        logger.level = 'silent';
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });

        // Exercise the real migrations and Prisma relation queries, not a database mock.
        const migrations = resolve(__dirname, '../../../../prisma/migrations');
        for (const directory of (await readdir(migrations, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()) {
            await getPGlite()!.exec(await readFile(`${migrations}/${directory}/migration.sql`, 'utf8'));
        }
        await db.account.createMany({ data: [
            { id: 'owner', publicKey: 'owner-fixture-key' },
            { id: 'other', publicKey: 'other-fixture-key' },
        ] });
        await db.session.createMany({ data: [
            ...recentIds.map((id) => ({ id, tag: id, accountId: 'owner', active: false, metadata: 'encrypted', createdAt: older, updatedAt: older })),
            ...['active-old', 'archive-old', 'archive-boundary', 'empty-old', 'renamed-old'].map((id) => ({
                id, tag: id, accountId: 'owner', active: id === 'active-old', metadata: 'encrypted', createdAt: older, updatedAt: older,
            })),
            { id: 'empty-recent', tag: 'empty-recent', accountId: 'owner', active: false, metadata: 'encrypted', createdAt: cutoff, updatedAt: cutoff },
            { id: 'other-account', tag: 'other-account', accountId: 'other', active: true, metadata: 'other-encrypted', createdAt: now },
        ] });
        await db.sessionMessage.createMany({ data: [
            ...recentIds.map((sessionId) => ({ sessionId, seq: 2, content: { t: 'encrypted' as const, c: 'newer-message' }, createdAt: now })),
            ...['active-old', 'archive-old', 'renamed-old', recentIds[0]].map((sessionId) => ({
                sessionId, seq: 1, content: { t: 'encrypted' as const, c: 'older-message' }, createdAt: older,
            })),
            { sessionId: 'archive-boundary', seq: 1, content: { t: 'encrypted' as const, c: 'boundary-message' }, createdAt: cutoff },
        ] });
        await db.session.update({ where: { id: 'renamed-old' }, data: { metadata: 'renamed-encrypted', updatedAt: now } });

        await auth.init();
        ownerToken = await auth.createToken('owner');
        otherToken = await auth.createToken('other');
        // Require signature verification on the first request, not just the issuance cache.
        auth.invalidateToken(ownerToken);
        auth.invalidateToken(otherToken);

        const instance = fastify();
        instance.setValidatorCompiler(validatorCompiler);
        instance.setSerializerCompiler(serializerCompiler);
        app = instance.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;
        enableAuthentication(app);
        sessionRoutes(app);
        v3SessionRoutes(app);
        baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
    }, 60_000);

    afterAll(async () => {
        await app?.close();
        await db.$disconnect();
        await getPGlite()?.close();
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllEnvs();
    });

    async function request(path: string, token: string | null = ownerToken) {
        return fetch(`${baseUrl}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    }

    async function allPages(params: Record<string, string>, token = ownerToken) {
        const sessions: ListedSession[] = [];
        const cursors = new Set<string>();
        let cursor: string | null = null;
        let pageCount = 0;
        do {
            const query = new URLSearchParams({ limit: '50', ...params, ...(cursor ? { cursor } : {}) });
            const response = await request(`/v2/sessions?${query}`, token);
            expect(response.status).toBe(200);
            const page = await response.json() as SessionPage;
            sessions.push(...page.sessions);
            pageCount++;
            expect(page.hasNext).toBe(page.nextCursor !== null);
            cursor = page.nextCursor;
            if (cursor) {
                expect(cursors.has(cursor)).toBe(false);
                cursors.add(cursor);
            }
        } while (cursor);
        return { sessions, pageCount };
    }

    it('includes archives at the inclusive 90-day boundary and pages past the old 150-session cap', async () => {
        const { sessions, pageCount } = await allPages({ lastMessageSince: String(cutoff.getTime()) });
        const ids = sessions.map((session) => session.id);
        expect(pageCount).toBe(5);
        expect(ids).toEqual([...recentIds, 'active-old', 'archive-boundary', 'empty-recent'].sort().reverse());
        expect(new Set(ids).size).toBe(ids.length);
        expect(sessions.find((session) => session.id === 'archive-boundary')).toMatchObject({ active: false, lastMessageAt: cutoff.getTime() });
        expect(sessions.find((session) => session.id === 'active-old')?.lastMessageAt).toBe(older.getTime());
        expect(sessions.find((session) => session.id === 'empty-recent')?.lastMessageAt).toBeNull();
        expect(sessions.find((session) => session.id === recentIds[0])?.lastMessageAt).toBe(now.getTime());
    });

    it('excludes recently renamed old archives and includes them when the search window widens', async () => {
        const filtered = await allPages({ lastMessageSince: String(cutoff.getTime()) });
        expect(filtered.sessions.map((session) => session.id)).not.toContain('renamed-old');
        expect(filtered.sessions.map((session) => session.id)).not.toContain('archive-old');
        expect(filtered.sessions.map((session) => session.id)).not.toContain('empty-old');
        const expanded = await allPages({});
        expect(expanded.sessions.map((session) => session.id)).toEqual(expect.arrayContaining(['renamed-old', 'archive-old', 'empty-old']));
        expect(expanded.sessions.find((session) => session.id === 'renamed-old')).toMatchObject({ updatedAt: now.getTime(), lastMessageAt: older.getTime() });
        expect(await db.session.count({ where: { accountId: 'owner' } })).toBe(211);
    });

    it('makes the whole qualifying conversation available, including messages older than the cutoff', async () => {
        const response = await request(`/v3/sessions/${recentIds[0]}/messages?after_seq=0&limit=100`);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ hasMore: false, messages: [
            { seq: 1, createdAt: older.getTime(), content: { t: 'encrypted', c: 'older-message' } },
            { seq: 2, createdAt: now.getTime(), content: { t: 'encrypted', c: 'newer-message' } },
        ] });
    });

    it('keeps every page account-scoped and rejects unauthenticated or other-account reads', async () => {
        const owner = await allPages({ lastMessageSince: String(cutoff.getTime()), limit: '200' });
        expect(owner.sessions.map((session) => session.id)).not.toContain('other-account');
        const other = await allPages({ lastMessageSince: String(cutoff.getTime()) }, otherToken);
        expect(other.sessions.map((session) => session.id)).toEqual(['other-account']);
        expect((await request('/v2/sessions', null)).status).toBe(401);
        expect((await request('/v2/sessions', 'invalid-token')).status).toBe(401);
        expect((await request(`/v3/sessions/${recentIds[0]}/messages`, otherToken)).status).toBe(404);
        const cursor = await request('/v2/sessions?cursor=cursor_v1_recent-100', otherToken);
        expect(cursor.status).toBe(200);
        expect((await cursor.json() as SessionPage).sessions.map((session) => session.id)).toEqual(['other-account']);
    });

    it('combines the coverage filter with existing change tracking', async () => {
        const filtered = await allPages({ lastMessageSince: String(cutoff.getTime()), changedSince: String(cutoff.getTime() - 1) });
        expect(filtered.sessions.map((session) => session.id)).toEqual(['empty-recent']);
    });

    it.each(['-1', 'not-a-date', '8640000000000001'])('rejects invalid cutoff %s', async (value) => {
        expect((await request(`/v2/sessions?lastMessageSince=${value}`)).status).toBe(400);
    });
});
