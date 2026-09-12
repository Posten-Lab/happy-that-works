# Session search validation

The fixture uses an isolated local PGlite server and the actual Expo web app. It
creates a fresh account through `/v1/auth`, then creates encrypted sessions and
messages through `/v1/sessions` and `/v3/sessions/:id/messages`. Only historical
timestamps are adjusted directly in the fixture database while its server is
stopped. No HTTP requests are mocked and no agent daemon is started.

```sh
pnpm install --frozen-lockfile
pnpm exec tsx scripts/evidence/session-search.mts setup
pnpm exec tsx scripts/evidence/session-search.mts verify <environment-name>
pnpm exec tsx scripts/evidence/session-search.mts keepalive <environment-name>
pnpm env:down <environment-name>
```

`setup` prints the isolated web/server URLs and the environment name. Open that
web URL in a real browser; the development app authenticates automatically.
Credentials remain in the ignored `environments/data/envs/<name>` directory.
`verify` writes a safe API evidence report alongside the fixture manifest.

`setup` also starts a small authenticated session socket that sends a heartbeat
every 20 seconds for the old active conversation. This exercises normal presence
handling and prevents that fixture from timing out into an archive. The keeper
automatically exits when `env:down` removes the server PID; after restarting a
server separately, use `keepalive` to restart it. No coding agent daemon runs.

The fixture has **163 sessions**. The default window covers **161 sessions over
two pages**; the older-history scope covers all 163. The recent archive sits
beyond the ordinary 150-session list, so finding it exercises session pagination.

| Search query | Fixture / expected browser behavior |
| --- | --- |
| `copper lantern` | User message in “Release workflow,” archived three days ago. Default search finds it and labels it Archived. |
| `amber telescope` | User message in a 120-day-old archive. Absent by default; found after searching older sessions. |
| `cobalt compass` | User message in an active session whose latest message is 150 days old. Included by default. |
| `Violet orchard` | Archived title match. Included by default. |
| `silver otter` | Agent-only text. Absent with the default user/title scope; found when agent replies are included. |
| `emerald falcon` | User message at sequence 3 in a 230-message archive. The match is 180 days old but the session's latest message is one day old. Default search finds it; opening it should land on the old matching message. |
| `crimson badger` | Recently renamed archive whose latest message is 121 days old. Absent by default; included in older history. |
| `teal swallow` | Recent archived session without any messages. Title is searchable. |

The [API evidence](api-evidence.json) records real server checks for pagination,
cutoff behavior, last-message timestamps, and encrypted message history. Browser
interaction and screenshots are recorded separately; these API checks alone do
not establish that the UI renders or navigates correctly.

## Browser evidence — 2026-09-12

Validated the real Expo app against the fixture server in Chromium using
`agent-browser --session search-e2e`. Viewports were 390×844 (phone),
1280×633 (single pane), and 1280×900 (desktop sidebar). No application state or
HTTP response was mocked. DOM evaluation only inspected rendering, URLs and the
actual IndexedDB cache.

| Check | Result / evidence |
| --- | --- |
| Recent archive outside the usual 150 sessions | Found the user text, with highlighted words and Archived badge: [single pane](recent-archive-desktop.png), [phone](recent-archive-phone.png). |
| Old archive and wider history | Absent in [90-day scope](older-archive-excluded.png); present after [Search older sessions](older-archive-included.png). Returning to 90 days restored the cutoff. |
| Active session with 150-day-old messages | Included in default scope: [active result](old-active-included.png). |
| Titles and empty recent archives | `Violet orchard` and `teal swallow` both found their sessions. |
| Rename does not refresh an old archive | `crimson badger` had zero results in default scope. |
| Agent replies | `silver otter` absent by default, found when enabled: [agent result](agent-replies.png). The checkbox exposes `aria-checked=true`. Opening it revealed the matching agent message. |
| Old match inside a recently used session | Opened sequence 3 in a 230-message session: [desktop sidebar](long-history-match.png). The visible matching row had x=360, y=144, width=920, height=85. |
| Reload an exact result | [Phone reload](reloaded-match-phone.png) restored the message outside the ordinary session list. Its row remained visible at y=501…610. URLs contained only session/message/sequence/block identifiers, with no search keywords. |
| Keyboard shortcut | Ctrl+K opened/focused search from a conversation in the single-pane layout and from Settings in the desktop layout. |
| Phone layout | The 390px viewport had a 390px document width and a 366px result card; no horizontal overflow. |
| Live updates | With `indigo kestrel` entered, real API/socket create and rename appeared without reloading; [archiving](live-archive-phone.png) kept the result and added its badge; deleting removed it. The temporary session was deleted and the original fixture verified again. |
| Private persistence | Inspected 317 IndexedDB records: all values were strings, and none contained any of the known plaintext fixture phrases. |

Representative browser commands:

```sh
agent-browser --session search-e2e open http://localhost:62741
agent-browser --session search-e2e fill '[data-testid="session-search-input"]' 'copper lantern'
agent-browser --session search-e2e wait '[data-testid="session-search-result"]'
agent-browser --session search-e2e snapshot -i
agent-browser --session search-e2e click '<matching excerpt ref from snapshot>'
agent-browser --session search-e2e wait '[data-testid="session-search-target"]'
agent-browser --session search-e2e set viewport 390 844
agent-browser --session search-e2e press 'Control+k'
```

For target visibility checks, select the nonzero-size matching row: React
Navigation can retain hidden earlier screens with the same test ID. Assert the
visible row is below the header and above the viewport bottom, rather than merely
asserting that a matching DOM node exists.

Final automated validation:

```sh
pnpm --filter talos-app typecheck                       # passed
pnpm --filter talos-app exec vitest run                 # 820 tests / 78 files passed
pnpm --filter @ahmadposten/talos-server typecheck        # passed
pnpm --filter @ahmadposten/talos-server test             # 112 tests / 18 files passed
pnpm exec tsx scripts/evidence/session-search.mts verify swift-island # passed
git diff --check                                       # passed
```

## Delivery notes

Deploy the server change before the updated app: archive eligibility depends on
the new `lastMessageSince` filter and `lastMessageAt` response field. No database
migration is required. The search index runs on the client; its resumable encrypted
cache uses IndexedDB on web and app cache files on native. New devices need an
initial history download. Native rendering was typechecked; the UI evidence above
is from actual browser runs, including the phone-sized viewport.

## Live changes

Keep search open on `indigo kestrel`, then run each stage separately and observe
the browser between stages. These commands create an extra session temporarily;
the original `verify` count returns after `live-delete`.

```sh
pnpm exec tsx scripts/evidence/session-search.mts live-create <environment-name>
pnpm exec tsx scripts/evidence/session-search.mts live-rename <environment-name>
pnpm exec tsx scripts/evidence/session-search.mts live-archive <environment-name>
pnpm exec tsx scripts/evidence/session-search.mts live-delete <environment-name>
pnpm exec tsx scripts/evidence/session-search.mts verify <environment-name>
```

Creation sends an encrypted user message through the actual message API. Rename
uses an authenticated `update-metadata` socket event and changes the title to
“Indigo kestrel renamed.” Archive and deletion use the real session endpoints.
The session/message IDs and current stage are stored in the environment's
ignored `session-search-live-fixture.json`; no credentials are printed.
