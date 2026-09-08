# Talos CLI 1.0.8

This patch packages Muse attachment support merged in PR #31. Web/mobile delivery
alone does not update the local CLI: 1.0.7 continues to reject uploaded files with
“This provider currently accepts text prompts.” Install 1.0.8 and resume existing
Muse sessions with the new runner after their current turn finishes. A previously
rejected attachment must be sent again.

PNG/JPEG/GIF/WebP inputs use Muse's native image parts. Other attachments are
stored in a private persistent cache for Muse's file tools. Message ordering and
per-file status are preserved. See the [real browser and provider evidence](../research/evidence/muse-attachments/README.md).

Prepublication checks on macOS arm64 / Node 25.1.0:

- `pnpm install --frozen-lockfile`
- `pnpm --filter @ahmadposten/talos-wire test`: 29 tests passed.
- `pnpm --filter talosapp run prepublishOnly`: build/typecheck and 1,008 tests passed.
- Built agent, server, and the production bundled web app (Bun 1.4.2).
- `pnpm verify:brand`: passed.
- `pnpm verify:packaged`: passed CLI-only isolated/hoisted installs and full
  isolated/hoisted/cached installs, native tools, version output, relay startup,
  database-backed authentication and bundled web identity.
- Inspected `talosapp-1.0.8.tgz`: 77 files, MIT license, wire dependency 0.1.1,
  with no credentials, source tree, local session state or unpacked tool cache.

Publish through `pnpm release cli --publish`, which selects the approved private
credential and reruns the complete publication hooks. Publication and installation
results are recorded in the release PR.
