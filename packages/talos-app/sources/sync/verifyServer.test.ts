import { describe, expect, it, vi } from 'vitest';
import { verifyServer } from './verifyServer';
import { legacyServerBanner } from '@ahmadposten/talos-wire';

describe('Talos relay verification', () => {
    it('checks the API identity instead of the web root', async () => {
        const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ service: 'talos', protocol: 1 })));
        expect(await verifyServer('https://relay.example/', request)).toBe(true);
        expect(request.mock.calls[0][0]).toBe('https://relay.example/v1/status');
        expect(request.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    });
    it.each([{ service: 'other', protocol: 1 }, { service: 'talos', protocol: 2 }, {}])('rejects incompatible servers: %j', async status => {
        expect(await verifyServer('https://relay.example', vi.fn().mockResolvedValue(new Response(JSON.stringify(status))))).toBe(false);
    });
    it('rejects server errors even if their body looks compatible', async () => {
        expect(await verifyServer('https://relay.example', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })))).toBe(false);
    });
    it('allows explicitly selected earlier relays that have the protocol banner', async () => {
        const request = vi.fn().mockResolvedValueOnce(new Response('', { status: 404 }))
            .mockResolvedValueOnce(new Response(legacyServerBanner));
        expect(await verifyServer('https://relay.example', request)).toBe(true);
    });
    it('rejects an unrelated website', async () => {
        const request = vi.fn().mockResolvedValueOnce(new Response('', { status: 404 }))
            .mockResolvedValueOnce(new Response('<html>Another product</html>'));
        expect(await verifyServer('https://relay.example', request)).toBe(false);
    });
});
