# Attachment E2E — evidence manifest

Feature branch: `feat/attachments`. Target: iOS Simulator (iPhone 17 Pro, iOS 26.1).

## Environment

- **Server**: `packages/talos-server` `pnpm standalone:dev` on `localhost:3005`,
  PGlite + local-disk blob storage (`./data/files/`, `isLocalStorage() = true`).
  Prod flips to MinIO/S3 via env vars — no code change.
- **App**: `com.slopus.talos.dev` dev-client build (`pnpm ios`), Metro on `:8081`,
  pointed at `EXPO_PUBLIC_TALOS_SERVER_URL=http://localhost:3005`.
- **CLI**: `packages/talos-cli/bin/talos.mjs --yolo` in a scratch project dir,
  `TALOS_SERVER_URL=http://localhost:3005`, paired to the app account.
- **Fixtures**: `~/tmp/talos-attachment-fixtures/` — see [`fixtures.json`](./fixtures.json).
  Pushed to sim Photos (`xcrun simctl addmedia`) and to the Files-app "On My iPhone"
  container (FileProvider LocalStorage).
- **Driver**: Maestro point-taps + `xcrun simctl` for screenshots (`~/.maestro/bin/maestro`,
  `JAVA_HOME=/opt/homebrew/opt/openjdk`). AppleScript AXPress for iOS system alerts
  (Photos-permission / notifications) that Maestro can't reach inside RN modals.

## The headline proof — image roundtrip + real inference

[`01-image-roundtrip-reply.png`](./01-image-roundtrip-reply.png)

A photo was attached from the composer and sent. The screenshot shows Claude's
**actual vision analysis of the pixels** that travelled the full pipeline:

> **Silky white water** blurred into smooth streaks — the classic effect of a
> slow shutter speed (long exposure).
> **Dark volcanic-looking rock** in the center, wet and glistening.
> **Vibrant green and orange moss** carpeting the rocks in the foreground and edges.
> It has the look of an Icelandic or Pacific Northwest stream. Nice shot.

This single frame exercises the **entire** attachment path end to end:

```
composer picker → AttachmentPreview → encryptBlob → presigned upload
   → CLI file-event → download → decryptBlob → attachmentRouter.routeBatch
   → image ContentBlockParam (base64) → Anthropic vision API
   → Claude reply → rendered inline in the app transcript
```

The same frame also shows, in the composer:
- a **`clip.mp4` video file-chip** (video icon + filename) — the non-image
  `AgentInputAttachmentStrip` chip variant rendering a video attachment, and
- **both picker buttons** (image icon + paperclip document icon) side by side.

## Setup evidence

| # | Screenshot | Shows |
|---|---|---|
| — | [setup-02-onboarding.png](./setup-02-onboarding.png) | App on `localhost:3005`, create-account screen (fresh, no cached prod creds) |
| — | [setup-03-terminals-connected.png](./setup-03-terminals-connected.png) | "Terminals — connected"; account created against local server |
| — | [setup-04-cli-paired.png](./setup-04-cli-paired.png) | CLI paired via QR-URL approval ("Terminal connected successfully") |
| — | [setup-05-feature-flag-on.png](./setup-05-feature-flag-on.png) | Settings → Features → Image Upload experiment toggled on |
| — | [setup-06-composer-with-pickers.png](./setup-06-composer-with-pickers.png) | In-session composer showing the image **and** document picker buttons |
| — | [00-app-fresh-launch.png](./00-app-fresh-launch.png) / [01-onboarding.png](./01-onboarding.png) / [02-dev-client-launcher.png](./02-dev-client-launcher.png) | Dev-client build + Metro handoff |

## Coverage note — the other routes

The image roundtrip proves the shared pipeline (pick → encrypt → upload →
download → decrypt → route → content-block → API → render). The *per-type
routing decisions* (which the router makes once bytes are in hand) are proven
deterministically by **40 unit tests** in
`packages/talos-cli/src/claude/utils/attachmentRouter.test.ts`:

| Attachment | Router decision | Covered by |
|---|---|---|
| PNG / JPEG / GIF / WebP ≤3.5 MB | `image` content block | matrix tests + this E2E |
| PDF ≤22 MB | `document` content block | matrix tests |
| PDF > 22 MB | downgrade → `@path` | threshold test |
| Image > 3.5 MB | downgrade → `@path` | threshold test |
| HEIC / HEIF / SVG | `@path` (API rejects these image types) | matrix tests |
| `text/*`, source, JSON, XML | `@path` (Claude Read parity) | matrix + UTF-8 probe tests |
| `video/*`, `audio/*` | `@path` temp file | matrix tests + video chip render (this E2E) |
| unknown / octet-stream | `@path` | matrix tests |
| empty bytes / download-fail | `reject` + `file-status` | reject tests |
| no attachments | plain-string hot path preserved | assembly test |

Batch assembly order (`[images, documents, text-with-@paths]`) and temp-file
content-addressing are asserted in the same suite.

## Suites (this branch)

- `packages/talos-cli` vitest — **733 passed / 18 skipped** (77 files), tsc clean.
- `packages/talos-app` vitest — **689 passed** (54 files), tsc clean.
