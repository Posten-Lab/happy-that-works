# talos-wire

This document describes the shared wire package: `@ahmadposten/talos-wire`.

## Why this package exists

Before `talos-wire`, wire-level message and session-protocol schemas were duplicated across packages (CLI, app, server, and agent). That caused drift risk and made protocol evolution harder.

`@ahmadposten/talos-wire` centralizes those shared schemas and types so all clients and services agree on the same wire contract.

## Package identity

- npm name: `@ahmadposten/talos-wire`
- workspace path: `packages/talos-wire`
- package type: publishable library (not private)
- versioned dependency in consumers: `^0.1.0`

## What is shared

### 1. Wire message schemas

Shared from `@ahmadposten/talos-wire`:
- from `messages.ts`: `SessionMessageContentSchema`, `SessionMessageSchema`, `MessageMetaSchema`, `SessionProtocolMessageSchema`, `MessageContentSchema` (top-level `role` union: `user|agent|session`), `UpdateNewMessageBodySchema`, `UpdateSessionBodySchema`, `UpdateMachineBodySchema`, `CoreUpdateContainerSchema`
- from `legacyProtocol.ts`: `UserMessageSchema` (`role: 'user'`), `AgentMessageSchema` (`role: 'agent'`), `LegacyMessageContentSchema` (`role`-discriminated union for legacy only)

These are used for encrypted message/update contracts (`new-message`, `update-session`, `update-machine`).

### 2. Session protocol schema

Shared from `@ahmadposten/talos-wire`:
- `sessionEventSchema`
- `sessionEnvelopeSchema`
- `createEnvelope(...)`
- `SessionEnvelope` and related types

This is the canonical schema for the unified session protocol event stream.

Current role set in `sessionEnvelopeSchema`:
- `'user'` (user-originated envelope)
- `'agent'` (agent/system output envelopes)

Current session wire payload shape (decrypted message body):
- outer message `role` is always `'session'` for session-protocol records
- `content` is the session envelope object directly (not wrapped under `content.data`)
- envelope-level role remains inside `content.role` (`'user' | 'agent'`)
- envelope timestamp is required as `content.time` (Unix ms)

## Migration in this repository

### CLI (`packages/talos-cli`)

- Session protocol imports now reference `@ahmadposten/talos-wire` directly.
- `src/sessionProtocol/types.ts` now re-exports from `@ahmadposten/talos-wire` as compatibility shim.
- API wire schemas in `src/api/types.ts` now source shared message/update schemas from `@ahmadposten/talos-wire`.

### App (`packages/talos-app`)

- Shared API message/update schemas in `sources/sync/apiTypes.ts` now import these from `@ahmadposten/talos-wire`:
  - `ApiMessageSchema`
  - `ApiUpdateNewMessageSchema`
  - `ApiUpdateSessionStateSchema`
  - `ApiUpdateMachineStateSchema`

### Server (`packages/talos-server`)

- Prisma JSON message content type now references `SessionMessageContent` from `@ahmadposten/talos-wire`.
- Event router uses shared `SessionMessageContent` type for `new-message` payload typing.

### Agent (`packages/talos-agent`)

- `RawMessage` now aliases `SessionMessage` from `@ahmadposten/talos-wire`.

## Versioning model

All other workspace packages now declare a versioned dependency on `@ahmadposten/talos-wire`.

This intentionally mirrors post-publish consumption and reduces hidden coupling to workspace-local files.

## Build and release

`@ahmadposten/talos-wire` is configured the same way as existing publishable libraries in this repo:

- ESM/CJS/types outputs via `pkgroll`
- `build`: typecheck + bundle
- `test`: build + vitest
- `prepublishOnly`: build + test
- `release`: `release-it`
- npm publish registry configured via `publishConfig`

Use the same release entrypoint as other publishable packages:

```bash
yarn release
# choose talos-wire
```

or:

```bash
yarn workspace @ahmadposten/talos-wire release
```

When building workspaces from a clean checkout, build `@ahmadposten/talos-wire` first so dependent packages can resolve generated `dist` outputs.

## Publish checklist (maintainer)

1. Ensure all workspace builds/tests are green.
2. Confirm wire schema changes are backward-compatible or documented.
3. Bump and release `@ahmadposten/talos-wire`.
4. Update downstream package versions if needed.
5. Publish dependent package updates only after the new `talos-wire` version is available.

## Notes

- `talos-wire` should stay focused on wire contracts only (types + Zod schemas + small helpers).
- Domain/business logic should remain in consumer packages.
- Keep schema additions additive where possible to minimize client breakage.
