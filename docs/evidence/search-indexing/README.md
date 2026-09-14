# Session indexing performance

Real Chrome, the Expo app, a standalone PGlite relay, signed API authentication,
a registered device, and encrypted conversation data. The browser starts with a
fresh profile, opens search, refreshes the completed index, reloads using encrypted
IndexedDB history, then opens a matching message at phone width. HTTP is not mocked.

The fixture contains 226 sessions and 14,500 encrypted messages. Its newest session
contains 10,000 messages and is visited first. Chrome CDP applies 100 ms network
latency with unlimited bandwidth. Both versions read all 275 message pages.
These are local development-build measurements, not production latency guarantees
or native-device measurements.

Baseline: `eb890d3b551d263443e301fd27e20b052fdfcf72` (`origin/main`).
Fixed version: the source in this PR.

| Measurement | Before | After |
| --- | ---: | ---: |
| First completed session | 9.678 s | 0.585 s |
| First short-conversation message result | 9.828 s | 0.585 s |
| All 226 sessions indexed | 48.179 s | 15.467 s |
| Reopen, from navigation to completed index | 1.510 s | 1.430 s |
| Lowest completed count during unchanged refresh | 0/226 | 226/226 |
| Message requests on reopen | 0 | 0 |

The fixed version keeps 226/226 throughout an unchanged refresh. Reopening fetches
zero message pages. Clicking the search snippet opens the correct conversation,
message sequence, and highlighted text. An additional browser inspection found
502 encrypted IndexedDB entries and no fixture title or message plaintext.

## Evidence

- [Baseline measurements](before.json) and [fixed measurements](after.json)
- [Early usable result during indexing](after-first-result.png)
- [Completed search](after-complete.png)
- [Search at phone width during cache restoration](after-mobile-width.png)
- [Opened matching message at phone width](after-opened-message.png)
- [Focused test output](tests.txt) and [typecheck output](typecheck.txt)

## Reproduce

Use a disposable local environment; credentials remain in ignored environment data.

```sh
pnpm install --offline --frozen-lockfile
pnpm exec tsx scripts/evidence/session-search.mts setup
pnpm exec tsx scripts/evidence/search-indexing-setup.mts <environment-name>
```

Run a separate Metro instance without the environment manager's automatic login
credentials so the benchmark can log into its own account:

```sh
EXPO_PUBLIC_DEV_TOKEN= EXPO_PUBLIC_DEV_SECRET= \
EXPO_PUBLIC_TALOS_SERVER_URL=http://localhost:<server-port> BROWSER=none \
pnpm --filter talos-app web --port <benchmark-web-port>
```

With Chrome and Playwright available, run:

```sh
SEARCH_E2E_ENV=environments/data/envs/<environment-name> \
SEARCH_E2E_WEB=http://localhost:<benchmark-web-port> \
SEARCH_E2E_LABEL=after PLAYWRIGHT_MODULE=/path/to/playwright-core \
node scripts/evidence/search-indexing-browser.cjs
```

For the baseline, serve the baseline checkout on a different port, keeping the same
relay/fixture, and use `SEARCH_E2E_LABEL=before`. The benchmark creates a new Chrome
profile for each run. It reads development Metro exports only to observe indexing
progress and request a refresh; production search, crypto, HTTP, and cache code run
unchanged.

```sh
pnpm --filter talos-app exec vitest run sources/sync/search sources/components/sessionSearchPresentation.spec.ts
pnpm --filter talos-app typecheck
pnpm env:down <environment-name>
```

All 71 focused tests pass. Regression cases cover a stalled first request across
226 sessions, bounded concurrency, fair message pagination, unchanged refreshes,
concurrent cache restoration, isolated cache corruption, cancellation/logout,
deletions, failed durable writes, unreadable ciphertext, and pagination recovery.
The existing real-service `session-search.mts verify` also passed archive-window,
latest-message timestamps, and message/session pagination checks.
