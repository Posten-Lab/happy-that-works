# Video upload validation

Validated on 2026-09-14 against an isolated PGlite server with local attachment storage, the changed Expo web app in Chromium at 430 × 932, and the built Talos CLI running a real Codex session. No production sessions or files were used.

## Reproduction and fix

On the base revision (`7130fa06`), requesting an upload for a 12 MiB video plus the 40-byte encryption envelope returned HTTP 400: `body/size Too big: expected number to be <=10485760`. The picker accepts 100 MiB. The CLI also capped attachment downloads at 10 MiB.

The shared limits now permit 100 MiB of original data and 104,857,640 encrypted bytes. Server upload authorization, local PUT body limits, S3 POST policy, and CLI transfers use that limit. The app keeps a failed batch and its message in the composer, sends no partial batch, and preserves edits made while uploading.

## Real busy-session result

A generated 20,566,593-byte MP4 was selected through the actual Photos/video picker while Codex executed a 45-second Python sleep. CLI logs recorded the file arriving at 07:42:26.533, before the active turn completed at 07:42:49.310. The following turn prepared one local file, with zero skipped attachments. Codex ran `ffprobe` and `shasum` against the decrypted video and returned:

- Byte count: 20,566,593.
- Duration: 12.000000 seconds.
- SHA-256: `2d4640483c95973f102e29bb90ec4044820d7c6acecb24c436482a7da70de965` (matches the original file).

[Video selected during the active turn](video-ready-while-busy.png) · [Codex inspected the delivered video](video-inspected.png)

## Retry and boundary checks

The [verification script](../../../scripts/evidence/busy-video-upload.mts) uses real server endpoints, encryption and the CLI downloader. Its browser fault injection aborts only the second upload authorization request in a two-file batch. It then retries against the real server.

- Failed batch: zero text/file records sent; text and both files retained.
- Retry: exactly two file records and one text record sent; duplicate Enter ignored.
- While retry was pending: newer text and a third attachment were added and remained after delivery.
- 100 MiB boundary: real encrypted PUT returned 200; the CLI downloaded and decrypted identical bytes. Declaring one more encrypted byte returned 413.

[Failure preserves the draft](upload-failure-preserves-draft.png) · [Edits during upload](upload-in-progress-new-draft.png) · [Retry preserves the next draft](retry-success-preserves-new-draft.png)

Machine-readable results: [retry](retry-results.json), [100 MiB round trip](boundary-results.json).

Starting a new Codex session with a video was also exercised through the real daemon. An aborted upload retained the draft and created no messages. Retrying reused the same session (one session created in total), delivered the video, and received `NEW_SESSION_RETRY_OK` from Codex. [Retained first-message draft](new-session-retry.png) · [Completed retry](new-session-retry-complete.png) · [Results](new-session-results.json).

## Commands

```sh
pnpm install --frozen-lockfile
pnpm --filter @ahmadposten/talos-wire build
pnpm --filter talosapp build
# Creates an isolated server, web app, test account, and private browser-auth.js:
pnpm exec tsx scripts/evidence/open-attachments.mts
# Read the resulting environment directory; use its private credentials without printing them.
TALOS_HOME_DIR="$VIDEO_ENV/cli/home" TALOS_SERVER_URL="$VIDEO_SERVER" \
  node packages/talos-cli/bin/talos.mjs daemon start-sync
# In a separate process; run from an isolated scratch directory:
TALOS_HOME_DIR="$VIDEO_ENV/cli/home" TALOS_SERVER_URL="$VIDEO_SERVER" \
  node "$VIDEO_REPO/packages/talos-cli/bin/talos.mjs" codex --started-by daemon
npx --yes agent-browser --session video open "$VIDEO_WEB"
npx --yes agent-browser --session video eval --stdin < "$VIDEO_ENV/browser-auth.js"
npx --yes agent-browser --session video set viewport 430 932
# Enable attachment uploads in the test account, then open the new Codex session.
# Start the 45-second sleep, attach the video during it, and request ffprobe + SHA-256.
ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=1280x720:rate=30 \
  -t 12 -c:v mpeg4 -q:v 2 -an -y /tmp/talos-video-e2e.mp4
npx --yes agent-browser --session video get cdp-url
TALOS_E2E_PLAYWRIGHT="$PLAYWRIGHT_PACKAGE" pnpm exec tsx \
  --tsconfig packages/talos-cli/tsconfig.json scripts/evidence/busy-video-upload.mts \
  "$VIDEO_ENV" "$VIDEO_SESSION" "$VIDEO_CDP_URL" /tmp/talos-video-e2e.mp4
# With the test daemon running, open /new for the first-message retry check:
TALOS_E2E_PLAYWRIGHT="$PLAYWRIGHT_PACKAGE" node scripts/evidence/new-session-video-retry.cjs \
  "$VIDEO_ENV" "$VIDEO_CDP_URL" /tmp/talos-video-e2e.mp4
```

`PLAYWRIGHT_PACKAGE` is the installed Playwright package path, such as the copy installed with agent-browser. The script prints only results; test credentials remain in the private environment directory. Build wire before starting Metro, since rebuilding removes `dist` temporarily.

## Automated checks

- `pnpm --filter talos-app exec vitest run`: 908 tests passed.
- `pnpm --filter @ahmadposten/talos-server test`: 117 tests passed.
- `pnpm --filter talosapp exec vitest run --project unit src/api/apiSession.test.ts src/codex/utils/attachmentEvents.test.ts src/codex/utils/imageInput.test.ts src/muse/museAttachments.test.ts`: 53 tests passed.
- `pnpm --filter @ahmadposten/talos-wire exec vitest run`: 34 tests passed.
- App/server typechecks, CLI build, wire build and wire package creation passed.

Native iOS and a live S3 service were not exercised in this run. S3 policy limits are covered by server tests. Rollout requires publishing wire 0.1.4 before the consumer CLI/server packages, updating the server and CLI, and delivering the app update. Older servers and CLIs retain their old transfer limits until updated.
