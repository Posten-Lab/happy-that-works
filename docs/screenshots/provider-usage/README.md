# Provider usage and limits

Settings → Usage now shows account allowances for Codex and Claude alongside the existing usage analytics. It is available with experiments disabled. Values come from each connected machine's signed-in provider and include usage outside Talos; account snapshots are never summed across machines.

## Implementation

- The app calls the encrypted machine RPC `provider-usage` with `{ provider, refresh }`. The shared wire schema validates normalized quota windows, balances, reset times, account state and freshness.
- Codex uses `account/read` and `account/rateLimits/read` through its app server. The adapter starts no thread or model turn. It includes all returned metered buckets, credits, spending limits, available reset counts and reset-credit expiries.
- Claude uses the installed Agent SDK's `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()` on an idle query. The adapter submits no prompt, disables session persistence and hooks, and includes reported five-hour, weekly and model windows plus extra usage spending.
- When Claude supplies a complete structured display list, it is authoritative: legacy projections do not duplicate five-hour/weekly limits or expose internal buckets. Older responses retain their legacy base windows and additional model scopes. Structured money uses each amount's explicit exponent and currency. Exhausted credits, reached spending caps and user-disabled extra usage have distinct labels.
- Provider calls have a 20-second lifecycle bound and cleanup. Concurrent reads are deduplicated; quota refreshes are bounded to one attempt per provider per 30 seconds. The visible, foreground dashboard polls every five minutes and respects the retry time.
- Null values remain unknown. Percentage windows, provider credits, currency spending and reset counts retain separate units. Claude currency amounts match its formatter: JPY/KRW/VND use the reported amount; other currencies divide minor units by 100. A past reset time does not cause Talos to invent a fresh zero-usage window.
- Account IDs are hashed only when immutable provider identity is available. Codex requires the quota response's account ID. Current Claude SDK metadata supplies email and organization names rather than immutable account/workspace IDs, so Claude cards remain separate across machines. Neither adapter reuses backend quotas across requests based only on email or display names.

## Actual provider E2E

The final RPC check at **2026-09-06 21:17:42.029 UTC** exercised the actual local relay, built daemon, encrypted Socket.IO machine RPC and installed provider tools. Both providers returned authenticated account allowances. Its sanitized results and the initial check are embedded in [validation.json](./validation.json).

Codex returned **59% weekly allowance remaining**, **128.883025 credits**, **two available full-reset credits with expiry times**, and separate GPT-5.3-Codex-Spark five-hour and weekly windows at 100% remaining. The authenticated browser captures show **58% remaining** because account usage changed during the task. Earlier captures show 66%; their initial RPC check returned 68%. Provider quota values were not changed for screenshots.

Claude returned **91% weekly allowance remaining**, resetting **September 7 around 11:00 AM London time**, and **100% five-hour allowance remaining** with no reset time reported. Extra usage has **£0 spent against a £100 monthly spending cap**, but is unavailable with provider reason `out_of_credits`. The UI correctly shows **No credits**; the £100 cap is not presented as a funded balance.

An independent direct SDK read confirmed the same percentages and spending state without a model turn: session cost was zero and model usage was empty. The final browser assertions matched every Claude window's percentage and displayed reset time against encrypted RPC evidence, confirmed exactly two quota meters, checked the GBP cap and exhausted-credit explanation, and found no horizontal overflow. The initial signed-out state remains historical evidence; actual signed-in Claude validation is now complete.

The browser also verified that `experiments: false` still exposes Settings → Usage and opened the page through that entry.

## Screenshots

| Evidence | Files |
| --- | --- |
| Both providers authenticated, desktop | [Dark](./live-authenticated-desktop-dark.png), [light](./live-authenticated-desktop-light.png) |
| Authenticated Claude, mobile viewport | [Light](./live-authenticated-mobile-light.png) |
| Initial Codex data and Claude signed-out state | [Dark desktop](./live-desktop-dark.png), [light desktop](./live-desktop-light.png), [light mobile](./live-mobile-light.png) |
| Synthetic critical states, desktop | [Dark](./fixture-critical-desktop-dark.png), [light](./fixture-critical-desktop-light.png) |
| Synthetic critical states, mobile viewport | [Dark](./fixture-critical-mobile-dark.png), [light](./fixture-critical-mobile-light.png) |

The final screenshot inventory and hashes are recorded in `validation.json`. Additional unknown/offline captures, when present there, are synthetic scenarios.

Browser checks also covered unknown values without a fabricated 0%, a passed reset retaining its reported 0.5% remaining, saved readings when offline, expanding/collapsing the severity list, and no horizontal overflow at the tested viewports. Themes were selected explicitly through Appearance. These synthetic checks establish UI behavior, not signed-in Claude provider accuracy.

Account emails and host labels are replaced with neutral labels in the browser before publication. During initial scenario captures, unrelated real or fixture cards are hidden to isolate the named scenario; authenticated captures show the two actual providers, with the mobile viewport scrolled to Claude. Provider quota values are not altered. Fixture cards are explicitly labeled **Design validation**. They use the same product renderer and encrypted local relay, but their values are synthetic and are **not actual provider E2E evidence**. Mobile screenshots exercise a browser viewport, not a native iOS/Android build.

## Verification commands

Run from the repository root:

```sh
pnpm --filter @ahmadposten/talos-wire build
pnpm --filter talosapp build
pnpm --filter talos-app typecheck
pnpm --filter talos-app exec vitest run
pnpm --filter talosapp exec vitest run --project unit
pnpm --filter @ahmadposten/talos-wire exec vitest run
pnpm --filter talos-app exec vitest run sources/components/usage/providerUsagePresentation.test.ts sources/hooks/useProviderUsage.test.ts sources/sync/providerUsage.test.ts
```

The final complete runs passed **762 app tests in 71 files**, **833 CLI unit tests in 93 files**, and **29 wire tests in 3 files**: **1,624 tests**. CLI/wire builds and app typecheck passed. The initial implementation also passed a focused 18-test UI rerun; that coverage is not added to the final total. These are unit-suite results; they do not substitute for the provider and browser checks above.

## Manual reproduction

1. Build the wire and CLI packages, start an isolated Talos relay and web app using the repository environment runner, and connect a daemon built from this branch. Keep normal provider authentication on the machine; no API credentials belong in the mobile client.
2. Sign in to Codex and Claude on that machine using their normal CLIs. Open Settings → Usage with experiments disabled and no active Talos session. Compare each reported allowance, reset time and balance against the corresponding provider's own usage screen.
3. Refresh once, then refresh inside 30 seconds. Verify that the last display is retained while retry timing is respected. Navigate away/background the app and return; only visible foreground usage should poll.
4. Disconnect the machine after a successful read. Verify an offline/stale state without presenting old quota as fresh. Reconnect, refresh and verify recovery. Confirm that account/workspace changes do not reuse another account's allowance.
5. For visual-only scenarios, register a separate machine labeled Design validation against the isolated relay and return schema-valid synthetic `provider-usage` snapshots. Exercise reached/near limits, unknown values, disabled or unlimited balances, reset/expiry labels and offline state in both themes and desktop/mobile viewports. Keep this evidence separate from actual provider checks.

The local helper `environments/data/usage-e2e-rpc.ts` performed the recorded encrypted RPC check; it and environment credentials remain local and uncommitted. Re-running it in the original initialized environment uses `pnpm exec tsx environments/data/usage-e2e-rpc.ts`. The committed sanitized JSON is sufficient to inspect the recorded quota results without those credentials.

## Provider limitations

Claude's full-usage SDK method is explicitly experimental and may change. Its successful response can silently fall back to provider-cached data whose age is not exposed, so Talos reports when it checked and preserves that uncertainty instead of claiming a fresh server timestamp. Missing provider data, unsupported authentication and failures remain visible states. Model-specific buckets appear only when the provider supplies them. This change displays usage; it does not buy credits, redeem resets or change spending limits.
