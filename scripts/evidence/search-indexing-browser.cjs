// Real Chrome + Metro + standalone relay + encrypted IndexedDB. No mocked HTTP.
// SEARCH_E2E_ENV=environments/data/envs/<name> SEARCH_E2E_WEB=http://localhost:<port>
// SEARCH_E2E_LABEL=after PLAYWRIGHT_MODULE=/path/to/playwright-core node scripts/evidence/search-indexing-browser.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

async function main() {
    const directory = path.resolve(process.env.SEARCH_E2E_ENV);
    assert(directory.includes('/environments/data/envs/'));
    const fixture = JSON.parse(fs.readFileSync(path.join(directory, 'search-indexing-fixture.json')));
    const auth = JSON.parse(fs.readFileSync(path.join(directory, 'search-indexing-auth.json')));
    const web = process.env.SEARCH_E2E_WEB || fixture.web;
    assert.equal(new URL(web).hostname, 'localhost');
    const label = process.env.SEARCH_E2E_LABEL || 'after';
    assert.match(label, /^[a-z-]+$/);
    const output = path.resolve('docs/evidence/search-indexing');
    fs.mkdirSync(output, { recursive: true });
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await context.addInitScript(({ auth, web, server }) => {
            if (location.origin !== web) return;
            localStorage.setItem('auth_credentials', JSON.stringify(auth));
            window.__TALOS_CONFIG__ = { serverUrl: server };
            window.searchEvidence = { snapshots: [], firstMatch: null };
            const watch = setInterval(() => {
                if (typeof window.__r?.getModules !== 'function') return;
                const module = [...window.__r.getModules().values()].find(m => m.verboseName === 'sources/sync/search/sessionSearch.ts' && m.isInitialized);
                const search = module?.publicModule?.exports?.sessionSearch;
                if (!search) return;
                clearInterval(watch);
                window.searchCoordinatorEvidence = search;
                const record = () => {
                    window.searchEvidence.snapshots.push({ time: Date.now(), ...search.getSnapshot() });
                    if (window.searchEvidence.firstMatch === null && search.search('Quicksilver').some(result => result.matches.length)) window.searchEvidence.firstMatch = Date.now();
                };
                record();
                search.subscribe(record);
            }, 5);
        }, { auth, web, server: fixture.server });
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 100, downloadThroughput: -1, uploadThroughput: -1 });
        let requests = [];
        page.on('request', request => {
            if (request.url().startsWith(fixture.server)) requests.push({ time: Date.now(), route: new URL(request.url()).pathname, query: new URL(request.url()).search });
        });
        await page.goto(web, { waitUntil: 'domcontentloaded' });
        const input = page.getByRole('textbox', { name: 'Search sessions', exact: true });
        await input.waitFor({ timeout: 60_000 });
        await input.fill('Quicksilver');
        await page.waitForFunction(() => window.searchEvidence?.firstMatch != null, null, { timeout: 90_000 });
        await page.getByRole('button', { name: 'Benchmark conversation 225', exact: true }).waitFor();
        await page.screenshot({ path: path.join(output, `${label}-first-result.png`) });
        await page.waitForFunction(() => {
            const snapshot = window.searchCoordinatorEvidence?.getSnapshot();
            return snapshot?.indexedSessions === 226 && !snapshot.isIndexing;
        }, null, { timeout: 120_000 });
        const cold = await page.evaluate(() => window.searchEvidence);
        assert.equal(cold.snapshots.at(-1).error, null);
        const beginning = requests.find(item => item.route === '/v2/sessions').time;
        const completed = cold.snapshots.find(item => item.indexedSessions === 226 && !item.isIndexing).time;
        const coldMessages = requests.filter(item => /^\/v3\/sessions\/[^/]+\/messages$/.test(item.route)).length;
        await page.screenshot({ path: path.join(output, `${label}-complete.png`) });
        const refreshCounts = await page.evaluate(async () => {
            const search = window.searchCoordinatorEvidence;
            const counts = [];
            const off = search.subscribe(() => counts.push(search.getSnapshot().indexedSessions));
            await search.start();
            off();
            return counts;
        });
        requests = [];
        const reloadTime = Date.now();
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => {
            const snapshot = window.searchCoordinatorEvidence?.getSnapshot();
            return snapshot?.indexedSessions === 226 && !snapshot.isIndexing;
        }, null, { timeout: 90_000 });
        const warm = await page.evaluate(() => window.searchEvidence);
        const warmMessages = requests.filter(item => /^\/v3\/sessions\/[^/]+\/messages$/.test(item.route)).length;
        assert.equal(warmMessages, 0, 'Reopening must use durable encrypted cached history');
        const warmDone = warm.snapshots.find(item => item.indexedSessions === 226 && !item.isIndexing).time;
        if (label === 'after') assert(refreshCounts.every(count => count === 226), 'Refresh must preserve completed progress');
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(web + '/?sessionSearch=benchmark', { waitUntil: 'domcontentloaded' });
        await page.getByRole('textbox', { name: 'Search sessions', exact: true }).fill('Quicksilver');
        await page.getByRole('button', { name: 'Benchmark conversation 225', exact: true }).waitFor();
        await page.screenshot({ path: path.join(output, `${label}-mobile-width.png`) });
        await page.getByRole('button', { name: /Quicksilver[\s\S]*benchmark needle/ }).click();
        await page.getByRole('button', { name: 'Dismiss search highlight' }).waitFor();
        assert.match(page.url(), /searchSeq=1/);
        await page.screenshot({ path: path.join(output, `${label}-opened-message.png`) });
        const report = { label, checkedAt: new Date().toISOString(), sessions: 226, encryptedMessages: 14500, largestSessionMessages: 10000, networkLatencyMs: 100, openedMatchingMessage: true,
            cold: { firstCompletedSessionMs: cold.snapshots.find(item => item.indexedSessions > 0).time - beginning, firstShortConversationMatchMs: cold.firstMatch - beginning, completeMs: completed - beginning, messageRequests: coldMessages },
            refresh: { minimumCompletedSessions: Math.min(...refreshCounts), maximumCompletedSessions: Math.max(...refreshCounts) },
            reopen: { completeFromNavigationMs: warmDone - reloadTime, messageRequests: warmMessages }, result: 'passed' };
        fs.writeFileSync(path.join(output, `${label}.json`), JSON.stringify(report, null, 2) + '\n');
        console.log(JSON.stringify(report, null, 2));
    } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
