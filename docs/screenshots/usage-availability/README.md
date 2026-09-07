# Usage availability and machine compatibility

The published and installed `talosapp@1.0.0` predates the provider-usage RPC. Both the Mac and Dell were running that package on September 7, 2026. The server's `RPC method not available` response also missed the app's outdated-daemon error pattern, producing misleading connection guidance after the reconnect grace period.

The new daemon advertises `providerUsage.rpcAvailable` in encrypted machine metadata. The app immediately explains how to update machines without this capability; it does not compare version numbers across Happy and Talos release namespaces. Capability changes trigger fresh reads. Providers have one heading each, unresolved machines share a status card, and verified distinct accounts or unidentified quota readings remain separate. No quotas are summed or merged based only on an email address.

The navigation header is now Usage & limits. The synchronous Codex version probe has a five-second bound so an unresponsive executable cannot indefinitely block quota collection.

## Verification

- App: 764 tests passed; typecheck passed.
- CLI: 833 tests passed, including its build after the version bump.
- Wire: 29 tests passed, including build.
- Encrypted E2E: real local relay, built 1.0.1 daemon, installed signed-in Codex and Claude, no model turns. Codex returned three windows and four balances in 1,272 ms; Claude returned two windows and one balance in 978 ms. See `rpc-verification.json`; account identities are redacted.
- Browser: real Expo app at 390 × 1000; two provider headings, five quota meters, no horizontal overflow or loading state. Two explicitly synthetic older machines exercised the compatibility fallback through the real local relay. See `browser-checks.json`.
- Screenshots show actual provider usage plus synthetic older-machine status rows. Personal account and actual machine labels were replaced before capture; quota values are unchanged.
- Packed `talosapp@1.0.1` contains both the quota RPC and capability metadata and depends on `@ahmadposten/talos-wire@0.1.1`.

## Delivery verification

`@ahmadposten/talos-wire@0.1.1` and `talosapp@1.0.2` are published under npm latest through the new `pnpm release` flow, with prepublish checks enabled. 1.0.2 corrects an existing-machine upgrade case found during production verification: registration returns saved metadata, so the daemon now refreshes its quota capability and running version after registering RPC handlers on each connection. A regression test verifies initial connection and reconnection while preserving machine labels.

The final CLI suite passes 834 tests; the app passes 764 tests, and wire passes 29 tests. Both production machine installations are verified separately against the tested bundle hashes and through encrypted provider RPC. Publication no longer depends on the expired default npm login; it uses the operator-provided npm user configuration without copying credentials.
