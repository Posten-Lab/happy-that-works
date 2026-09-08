# Mobile usage carousel

At dashboard content widths below 800 px, Settings → Usage shows connected providers as swipeable pages with named tabs. Each page contains that provider's verified accounts and connection details. Providers awaiting identity or sign-in remain reachable; they are not presented as extra accounts. A single provider needs no carousel. The existing desktop account grid and shared limits-to-watch summary remain in place.

The selected provider survives refresh and width changes. The carousel measures each page's natural height, so a shorter provider does not inherit another provider's empty space. Web tabs support arrow keys, Home/End, selected-state announcements, and focus management. Inactive pages are hidden from assistive technology and inert on web. Tab switches and resize alignment are immediate; touch swipes use native scroll paging.

## Real E2E validation

Validation used this branch's Expo web app, standalone PGlite relay, built CLI daemon, and encrypted provider-usage RPCs. Codex was authenticated and returned real allowances, credits, and reset details. Claude was signed out; its page displayed the actual sign-in diagnostic. No synthetic provider snapshots were used. Codex weekly allowance changed from 100% to 99% between captures as account activity continued.

These captures validate mobile browser behavior in Chrome with touch input enabled, not a native iOS or Android build. Authenticated Claude quota values were not retested because Claude was signed out. This change does not alter provider quota collection.

Passed browser assertions, recorded in [validation.json](./validation.json):

- Tab presses select the matching provider; only its page is accessible.
- Real Chrome touch swipes in both directions select and align the matching tab/page.
- Refresh on Claude preserves its selected page.
- Arrow keys, Home, and End move selection and focus, including wrapping.
- Carousel height matches the selected page (1,154 px for live Codex and 308 px for the signed-out Claude state at 390 px viewport width).
- Resizing between 390, 430, and 320 px retains the selected provider and aligns the page without horizontal document overflow.
- At 1280 px, the existing desktop grid replaces the carousel. Returning to mobile retains the previous selection.
- Light and dark themes render correctly. Browser error collection was empty.

Account emails and machine names were replaced with neutral text immediately before screenshots. Provider quota values were not changed. Credentials and local environment state are uncommitted.

## Screenshots

| State | Light | Dark |
| --- | --- | --- |
| Mobile: live Codex allowance | [Screenshot](./mobile-codex-light.png) | [Screenshot](./mobile-codex-dark.png) |
| Mobile: actual Claude sign-in state | [Screenshot](./mobile-claude-light.png) | [Screenshot](./mobile-claude-dark.png) |
| Desktop: existing account grid | [Screenshot](./desktop-light.png) | [Screenshot](./desktop-dark.png) |

## Commands and reproduction

```sh
pnpm install --frozen-lockfile
pnpm env:up --template authenticated-empty
# The environment runner builds the CLI. In this checkout, start its isolated
# daemon directly because `daemon start` delegates to the background service.
source environments/data/envs/brave-forest/env.sh
node packages/talos-cli/bin/talos.mjs daemon start-sync

pnpm --filter talos-app typecheck
pnpm --filter talos-app exec vitest run
pnpm --filter talos-app exec vitest run sources/components/usage/providerUsagePresentation.test.ts sources/hooks/useProviderUsage.test.ts sources/sync/providerUsage.test.ts
```

TypeScript passed. The full app suite passed **777 tests in 74 files**. The focused usage suite passed **24 tests in 3 files** (included in the full-suite count).

The locally installed `agent-browser` binary was invoked through `/tmp/talos-carousel-browser`. Open the isolated environment's private authenticated URL without publishing it, then navigate through Settings → Usage. Example interaction commands from the run:

```sh
/tmp/talos-carousel-browser --session usage-carousel set viewport 390 844
/tmp/talos-carousel-browser --session usage-carousel open http://localhost:63869/settings/usage
/tmp/talos-carousel-browser --session usage-carousel wait '[data-testid="usage-provider-carousel"]'
/tmp/talos-carousel-browser --session usage-carousel click '[data-testid="usage-tab-claude"]'
/tmp/talos-carousel-browser --session usage-carousel click '[aria-label="Refresh account usage"]'
/tmp/talos-carousel-browser --session usage-carousel focus '[data-testid="usage-tab-claude"]'
/tmp/talos-carousel-browser --session usage-carousel press ArrowLeft
/tmp/talos-carousel-browser --session usage-carousel press End
/tmp/talos-carousel-browser --session usage-carousel press Home
/tmp/talos-carousel-browser --session usage-carousel set viewport 430 932
/tmp/talos-carousel-browser --session usage-carousel set viewport 320 740
/tmp/talos-carousel-browser --session usage-carousel set viewport 1280 900
/tmp/talos-carousel-browser --session usage-carousel set viewport 390 844
/tmp/talos-carousel-browser --session usage-carousel errors
```

Touch validation used the same browser's CDP connection: `Emulation.setTouchEmulationEnabled` followed by `Input.dispatchTouchEvent` with `touchStart`, twelve `touchMove` events across the provider page, and `touchEnd`. Both swipe directions were checked against `aria-selected`, page inertness, scroll offset, and measured height. Light mode was selected through Settings → Appearance. Screenshot paths were absolute when passed to `agent-browser screenshot`.
