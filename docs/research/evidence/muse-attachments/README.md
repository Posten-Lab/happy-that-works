# Muse attachments — 2026-09-08

Validated on macOS arm64 with Muse CLI 1.0.3-R2198.1, SDK 0.1.1, Node 25.1.0
and an isolated Talos server, web app, CLI home and test account. Branch:
`feat/muse-attachments`, based on `origin/main` at `8e41c2e3`.

## Automated checks

```sh
pnpm --filter talosapp exec vitest run --project unit
pnpm --filter talos-app typecheck
pnpm --filter talos-app exec vitest run sources/sync/apiAttachments.test.ts sources/sync/attachmentSupport.test.ts sources/sync/attachmentDiagnostics.test.ts
```

- CLI build/typecheck and 1,008 unit tests in 113 files passed.
- App typecheck and 55 attachment tests in three files passed.
- Focused coverage includes slow-download ordering, attachment ownership between
  successive messages, attachment-only input, native rejection and recovery,
  byte-based image detection, safe private file storage and disk/empty-file errors.
- Codex continues using the same downloader and image detection implementations,
  now extracted into shared utilities; its attachment tests pass.

## Real native provider

From `packages/talos-cli`, with an authenticated Muse CLI:

```sh
pnpm exec tsx tests/muse-e2e/attachments-probe.ts
```

The committed PNG fixture contains `MAPLE-482` and a green circle. The prompt
contains neither answer. Muse returned both the code and the shape. A separate
uploaded text file contained `cobalt-713-otter`, which Muse read through its tools.
The fixture then closed the host, resumed the same native session, and read the
same cached file again. Both attachment refs were accepted.

Result: `MUSE_ATTACHMENTS_IMAGE_FILE_RESUME_PASSED`
(native session `01a07f92-c2a1-7111-b14b-7ba28b4cc5a2`). The existing Muse resume
recovery emitted two `unknown cursor anchor` notices; the actual resumed tool
read and answer still completed successfully. This change does not alter recovery.

## Real browser, encryption and upload transport

Provisioned with `pnpm exec tsx tests/muse-e2e/setup.ts`; environment `swift-summit`
used server port 49863 and web port 49864. Launched the built CLI with that
environment's `env.sh` and `talos muse --talos-starting-mode remote` in its fixture
workspace. Talos session: `cmts97pfq0002rih3ctfl04pk`.

Browser automation used `pnpm dlx agent-browser@0.20.0 --session muse-attachments`.
The Image Upload feature was enabled in the isolated test account. As in previous
browser validation, the checkbox needed its React change handler invoked because
automation's native click did not toggle it. The composer flow used DOM clipboard
paste, the real document picker input (`upload 'input[type=file]'`), and DOM Enter
keyboard events. The send/sync/upload/provider code was neither mocked nor bypassed.

1. Pasted the PNG into an empty composer. Verified the send arrow appears and
   Enter sends the image without accompanying text.
2. Muse recognized the code and green circle, renamed the test session accordingly,
   and asked what to do with the image. Selected and submitted “Explain the image”.
3. Selected a real text file containing `indigo-629-wren` through the document
   picker, pasted the PNG, and submitted both with a prompt to read their contents.
4. Muse invoked its file-reading tool and returned the text-file code, image code
   and green circle correctly.
5. Read the real server's encrypted message records, decrypted them with the
   isolated account key without logging credentials, and verified all three refs
   had persisted `file-status: accepted` events. A full browser reload retained
   the mixed-attachment answer.

Screenshots (real app and provider):

- [Image-only composer with send arrow](image-only-composer.png)
- [Image-only recognition](image-only-recognized.png)
- [Mixed image and file composer](mixed-composer.png)
- [Mixed attachment answer](mixed-result.png)

Native image input was exercised with PNG. JPEG/GIF/WebP share the existing
byte-signature detection and native image route; they were not separately sent
to the live provider. Generic file access was exercised with text; PDF, video and
other formats depend on Muse's native tools and are not advertised as inline media.
Cached non-image files are private (directory 0700, files 0600 on POSIX) and retained
for durable resume, with no automatic expiry. No production release was performed.
