# Talos Server

The Talos relay synchronizes encrypted sessions, devices, messages, and attachments. It supports embedded PGlite with local file storage, or operator-configured PostgreSQL, Redis, and S3-compatible storage.

## Installation

```sh
npm install -g talosapp @ahmadposten/talos-server
talos server
```

The `@ahmadposten/talos-server` package includes the local relay and web app. The `talosapp` package supplies the `talos` command.

## Local development

Build the CLI and start an isolated relay from the monorepo root:

```sh
pnpm --filter talosapp build
TALOS_HOME_DIR="$PWD/.talos-local" node packages/talos-cli/bin/talos.mjs server --no-persist
```

The CLI persists a master secret with the relay data. Keep that secret with your backups; replacing it can make server-encrypted data and existing authentication tokens unusable.

`pnpm --filter @ahmadposten/talos-server build` needs Bun on PATH to bundle the Node.js runtime. `pnpm --filter @ahmadposten/talos-server bundle:webapp` adds the Expo web export to this package. `pnpm verify:packaged` checks the actual installed tarballs, database, and bundled web page.

## Configuration

| Setting | Purpose |
| --- | --- |
| `TALOS_MASTER_SECRET` | Persistent master secret for server authentication and encryption |
| `HOST` / `PORT` | Listener address and port; local default is port 3005 |
| `DATA_DIR` / `PGLITE_DIR` | Embedded database and file storage directories |
| `DATABASE_URL` | External PostgreSQL connection |
| `REDIS_URL` | Optional shared event transport |
| `S3_HOST`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_PUBLIC_URL` | Optional object storage |
| `TALOS_WEBAPP_URL` | Web origin used for OAuth redirects |
| `TALOS_STATIC_DIR` | Optional web export directory to serve |

The old master-secret environment name remains a compatibility fallback. Always use the Talos name for a new deployment. Never generate a new secret on each restart of an existing data directory.

## Distribution and integration tests

The repository's `Dockerfile` builds a standalone relay image; `Dockerfile.server` builds the service used with external storage. See [production deployment templates](../../deploy/server) and the [Talos release requirements](../../docs/rebrand/README.md) for operator configuration. The npm distribution is `@ahmadposten/talos-server`.

The [minikube integration harness](deploy/integration-tests/AGENTS.md) uses the separate `talos-integration` namespace and a locally built image. Its destructive stress scenarios are for that test environment. Production deployment templates live at the repository root under `deploy/server`.

[MIT license](LICENSE).
