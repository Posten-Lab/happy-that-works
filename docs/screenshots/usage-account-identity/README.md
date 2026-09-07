# Provider account identity verification

The previous implementation rendered machine lookup failures as account cards. Claude's SDK also omitted user/organization IDs, so its successful readings on Mac and Dell remained separate. Live production probes confirmed identical Codex IDs on both computers, no Claude snapshot IDs, and identical Claude OAuth user/organization UUIDs in the two providers' sign-in metadata.

Claude now maps its stored OAuth user and organization UUIDs to the encrypted usage identity only when the SDK reports the same first-party email and organization, the metadata stays stable around the read, and no token override is active. Different users/workspaces remain distinct even when their display names match. Credentials are not read by this identity adapter. Missing or unverifiable identities remain connection diagnostics; they never create an account card. Their available quota readings are retained in the expanded details.

## Real end-to-end evidence

Two built 1.0.3 daemons ran on the actual Mac and Dell with their existing signed-in Codex/Claude installations. They used a separate test Talos identity and a real local relay (Dell reached it over an SSH reverse tunnel). No model turns were sent. Encrypted machine RPC returned matching Codex and Claude account IDs across both computers, with three Codex windows/four balances and two Claude windows/one balance per machine. `real-machine-rpc.json` records results without personal identities or credentials.

The actual Expo app ran at 390 × 1000 in Chromium via agent-browser. It displayed exactly one Codex card and one Claude card, each listing both computers. Two pre-existing synthetic older-daemon fixtures in the isolated relay remained offline and appeared only in Connection details. There were five quota meters and no horizontal overflow. `browser-checks.json` records DOM assertions. Account labels and actual hostnames were replaced before capture; provider quota values were unchanged.

- [Codex mobile view](mobile-codex.png)
- [Claude mobile view](mobile-claude.png)
- [Expanded connection diagnostics](mobile-connections.png)

## Automated checks

- `pnpm --filter talosapp test`: 840 tests passed, including build/typecheck.
- `pnpm --filter talos-app test`: 766 tests passed.
- `pnpm --filter talos-app exec tsc --noEmit`: passed.
- `pnpm verify:brand`: passed.
- `pnpm verify:packaged --cli-only`: isolated and hoisted CLI installations passed. The unrestricted checker requires builds for unchanged agent/server packages, so CLI publication uses its target-specific check.

Regression tests cover shared accounts across machines, truly different users/workspaces, missing identities, failed/unsigned/offline sources, alternate Claude configuration directories, token overrides, mismatched provider metadata, and account switching during usage retrieval.
