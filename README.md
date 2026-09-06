# Talos

Your agents. Your command.

Talos connects your coding agents to a private workspace on the web, your phone, and your desktop. Start a session on your computer, follow its progress, approve requests, and continue the conversation from another device. Session content is encrypted before it reaches the relay.

## Install

Publication is prepared but currently awaits npm publishing access; see the [rollout record](docs/rebrand/rollout.md) for availability.

```sh
npm install -g talosapp
talos auth login
```

The npm package is `talosapp`; the command is `talos`. Open [talosapp.ai](https://talosapp.ai) to connect your browser or phone.

## Develop locally

Requirements: Node.js, pnpm, and the tools required by your chosen agent. Native builds also require Xcode or the Android SDK.

```sh
pnpm install --frozen-lockfile
pnpm --filter @ahmadposten/talos-wire build
pnpm --filter talosapp build
pnpm --filter talos-app web
```

For an isolated local relay:

```sh
TALOS_HOME_DIR="$PWD/.talos-local" node packages/talos-cli/bin/talos.mjs server --no-persist
```

The relay generates and retains its master secret in that isolated directory. Reuse the directory to retain accounts and encrypted server data.

Set `TALOS_SERVER_URL` for the CLI and `EXPO_PUBLIC_TALOS_SERVER_URL` for the app when using another relay. The hosted default is `https://api.talosapp.ai`. For local development, use `http://localhost:3005`; a phone needs a reachable LAN address.

Run the built CLI directly:

```sh
node packages/talos-cli/bin/talos.mjs --help
node packages/talos-cli/bin/talos.mjs auth login
node packages/talos-cli/bin/talos.mjs claude
node packages/talos-cli/bin/talos.mjs codex
```

Talos uses `~/.talos` and the `TALOS_HOME_DIR` override. Run `talos migrate` to import an existing local account and cached session keys while its sessions continue running. See the [migration guide](docs/rebrand/migration.md).

## Workspaces

| Package | Purpose |
| --- | --- |
| [talos-app](packages/talos-app) | Expo web, iOS, Android, and Tauri desktop |
| [talos-cli](packages/talos-cli) | `talos` command and machine daemon |
| [talos-agent](packages/talos-agent) | `talos-agent` remote control command |
| [talos-server](packages/talos-server) | Relay, local storage, and bundled web hosting |
| [talos-wire](packages/talos-wire) | Shared protocol schemas and compatibility |
| [talos-desktop](packages/talos-desktop) | Electron desktop workspace |
| [talos-app-logs](packages/talos-app-logs) | Optional development log receiver |

The supplied [Talos brand assets](assets/talos) are the source of all product marks and launcher icons. [Architecture documentation](docs/README.md) describes the implementation.

## Distribution

The CLI package name is `talosapp`. Companion packages are `@ahmadposten/talos-wire`, `@ahmadposten/talos-agent`, and `@ahmadposten/talos-server`. Production endpoints, stores, signing, and OTA updates use the Talos settings in [.env.talos.example](.env.talos.example).

For this production installation, follow the [additive rollout](deploy/talos-production/README.md), which shares the existing account database and preserves active clients. Generic deployment templates are for separate installations.

See the [rebrand and release record](docs/rebrand/README.md) for compatibility boundaries, verification results, and remaining deployment configuration.

## License

[MIT](LICENSE). Copyright notices are preserved with each distributed package.
