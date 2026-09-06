import { legacyServerBanner } from '@ahmadposten/talos-wire';

/** A dedicated identity endpoint also works when the relay serves the web application at /. */
export async function verifyServer(url: string, request: typeof fetch = fetch): Promise<boolean> {
    const base = url.replace(/\/+$/, '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
        const response = await request(`${base}/v1/status`, {
            headers: { Accept: 'application/json' }, signal: controller.signal,
        });
        if (response.status === 404) {
            const legacy = await request(base, { signal: controller.signal });
            return legacy.ok && (await legacy.text()).trim() === legacyServerBanner;
        }
        if (!response.ok) return false;
        const status = await response.json();
        return status?.service === 'talos' && status?.protocol === 1;
    } finally {
        clearTimeout(timeout);
    }
}
