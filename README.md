# Talos

Your agents. Your command.

Talos connects your coding agents to a private workspace on the web, your phone, and your desktop. Start a session on your computer, follow its progress, approve requests, and continue the conversation from another device. Session content is encrypted before it reaches the relay.

## Develop locally

Requirements: Node.js, pnpm, and the tools required by your chosen agent. Native builds also require Xcode or the Android SDK.

```sh
pnpm install --frozen-lockfile
pnpm --filter @talos/wire build
pnpm --filter talos build
pnpm --filter talos-app web
```

For an isolated local relay:

```sh
TALOS_HOME_DIR="$PWD/.talos-local" node packages/talos-cli/bin/talos.mjs server --no-persist
```

The relay generates and retains its master secret in that isolated directory. Reuse the directory to retain accounts and encrypted server data.

Set `TALOS_SERVER_URL` for the CLI and `EXPO_PUBLIC_TALOS_SERVER_URL` for the app when using another relay. The development default is `http://localhost:3005`; a phone needs a reachable LAN address, not its own localhost.

Run the built CLI directly:

```sh
node packages/talos-cli/bin/talos.mjs --help
node packages/talos-cli/bin/talos.mjs auth login
node packages/talos-cli/bin/talos.mjs claude
node packages/talos-cli/bin/talos.mjs codex
```

`pnpm --filter talos cli:install` links this checkout as the local `talos` command. Talos uses `~/.talos` and the `TALOS_HOME_DIR` override. A new installation starts independently; link or restore an account explicitly to reuse it.

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

Production endpoints, package publication, stores, signing, and OTA updates need Talos-specific configuration. Copy the settings from [.env.talos.example](.env.talos.example) into your deployment environment. Packages remain private until the publishing namespace is confirmed. Do not install an unrelated registry package solely because it is named `talos`.

See the [rebrand and release record](docs/rebrand/README.md) for compatibility boundaries, verification results, and remaining deployment configuration.

## License

[MIT](LICENSE). Copyright notices are preserved with each distributed package.
