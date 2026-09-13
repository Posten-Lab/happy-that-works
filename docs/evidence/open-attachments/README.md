# Open chat attachments

Validated on 2026-09-13 using an isolated PGlite Talos server and encrypted attachments uploaded through the real attachment API. The fixture uses the CLI's blob encryption and session-message encryption. No HTTP responses, crypto, app state, or attachment viewers were mocked for E2E.

## Checks

- `pnpm --filter talos-app typecheck` — passed.
- `pnpm --filter talos-app exec vitest run` — 87 files / 889 tests passed, including 11 native/web file-opening regression cases.
- `APP_ENV=development EXPO_PUBLIC_TALOS_SERVER_URL=http://localhost:59315 EXPO_PUBLIC_SERVER_URL=http://localhost:59315 pnpm exec expo export --platform web --output-dir /tmp/talos-attachments-web` (from `packages/talos-app`) — passed.
- `APP_ENV=development pnpm exec expo run:ios --device 94565182-2D79-4D69-AE91-CA54BF0E4DE5 --no-bundler` (from `packages/talos-app`) — built and installed successfully on iPhone 17 Pro / iOS 26.1.
- `git diff --check` — passed.

## Real service and UI results

`pnpm exec tsx scripts/evidence/open-attachments.mts` creates the isolated fixture, server, and Metro app. It writes credentials only beneath ignored `environments/data`; it does not print them. An existing fixture environment can be reused by appending its name. This run used `bold-comet`, API port 59315, Metro port 59316, and the exported web app on `127.0.0.1:59400`.

Browser automation used agent-browser 0.37.1. The exported app was served with an SPA fallback. Authentication was installed with `agent-browser eval --stdin < environments/data/envs/bold-comet/browser-auth.js`. On iOS, the local development credentials were loaded through the environment manager and the app was opened against Metro. Native taps and screenshots used `idb ui tap`, `idb ui describe-all`, and `xcrun simctl io … screenshot`.

| Flow | Result | Evidence |
| --- | --- | --- |
| Image, PDF, text and binary storage round trips | All four decrypted downloads match their original bytes | Fixture assertions |
| Tap model image on mobile web | Full image opens, filename and close/zoom/open controls remain visible | [Mobile viewer](image-open-mobile.png) |
| Tap model image on desktop web | Full image fits the window | [Desktop viewer](image-open-desktop.png) |
| Zoom and return to chat | Zoom in/out, Close, and Escape work | [Web zoom](image-zoom-mobile.png) |
| Legacy image message without MIME | Opens on web and iOS | [iOS viewer](image-open-ios.png) |
| Image download failure | Error and Retry shown; restoring the encrypted object through the API and tapping Retry loads the image | [Failure](image-load-error.png), [recovered](image-retry-recovered.png) |
| File download failure | Inline retry guidance; reserved browser tab closes; tapping again after restoring the encrypted PDF opens it | [Failure](file-load-error.png), [recovered PDF](file-retry-recovered.png) |
| PDF in browser | Opens the decrypted PDF in a new tab | [PDF](pdf-open-web.png) |
| Text in browser | Displays `Opened and decrypted from Talos chat.` | Verified browser text |
| Binary download | Downloaded file equals bytes `00 01 02 FE FF` | Byte comparison passed |
| Native image zoom | Zoom button changes to Zoom out and the image enlarges | [iOS zoom](image-zoom-ios.png) |
| Native image opening | Share sheet recognizes PNG; Apple Preview opens the original image | [Share sheet](image-share-ios.png), [Apple Preview](image-open-preview-ios.png) |
| Native PDF opening | Share sheet recognizes the 664-byte PDF and imports it into Apple Preview | [Share sheet](pdf-share-ios.png), [Apple Preview](pdf-open-preview-ios.png) |
| Native plaintext cleanup | No `talos-open-*` directories remain in the app cache after returning from Preview | Filesystem assertions passed |

The gear visible in native screenshots is Expo's development-tools overlay. Android and Tauri were not exercised. Other languages currently inherit the English attachment labels, following the existing fallback convention.

## Repeating failure recovery

The fixture deliberately creates `missing.png` and `missing.pdf` references without blobs. After capturing the failure, PUT the corresponding `fixtures/image.encrypted` or `fixtures/report.encrypted` bytes to `/v1/sessions/<sessionId>/attachments/missing.png` or `missing.pdf` using the fixture's private token. Tap Retry in the image viewer or tap the file card again. This uses the real storage and download endpoints.

Stop the fixture with `pnpm env:down bold-comet` (substitute the environment printed by setup).
