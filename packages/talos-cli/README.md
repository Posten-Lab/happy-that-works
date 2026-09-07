# Talos

Code on the go — control AI coding agents from your phone, browser, or terminal.

Free. Open source. Code anywhere.

## Installation

```bash
npm install -g talosapp
```

The npm package is `talosapp`; the command is `talos`. Open [talosapp.ai](https://talosapp.ai) to connect your browser or phone.

Installation sets up automatic background startup on macOS and Linux. Connect your account once with `talos auth login`; your machine then becomes available in the UI without starting a coding session in a terminal.

For local relay hosting, install `@ahmadposten/talos-server` alongside `talosapp` and run `talos server`.

## Usage

### Claude Code (default)

```bash
talos
# or
talos claude
```

This will:
1. Start a Claude Code session
2. Display a QR code to connect from your mobile device or browser
3. Allow real-time session control — all communication is end-to-end encrypted
4. Start new sessions directly from your phone or web while your computer is online

### More agents

```
talos codex
talos gemini
talos openclaw

# or any ACP-compatible CLI
talos acp opencode
talos acp -- custom-agent --flag
```

## Daemon

The daemon is a background service that stays running on your machine. It lets you spawn and manage coding sessions remotely — from your phone or the web app — without needing an open terminal.

```bash
talos daemon start
talos daemon restart
talos daemon stop
talos daemon status
talos daemon list
```

Background startup is enabled by default, and the OS restarts the daemon after crashes:

| Platform | Service |
|----------|---------|
| macOS | A per-user LaunchAgent in the GUI login domain, starting after login. |
| Linux with systemd | A user service with lingering enabled, starting at boot and continuing after logout. |
| Linux with OpenRC | A service in the default runlevel, supervised by `supervise-daemon`, running as your ordinary user. |

The service uses an absolute Node executable, your provider executable PATH and provider configuration directories. On macOS it joins your GUI login domain for access to the login keychain; it does not copy OAuth tokens into the service file. Provider account connection is still required for the agent you want to use.

If npm scripts are disabled, or installation runs as root, normal account connection completes service setup automatically for your ordinary user. OpenRC installation and some Linux lingering policies require administrative authorization; `talos auth login` requests it through sudo when a terminal is available. Unavailable service managers or denied authorization are reported explicitly. A temporary detached daemon provides availability during the current boot but does not provide automatic reboot startup.

`talos daemon stop` pauses the daemon while leaving coding sessions alive. A subsequent start, account login or normal Talos session starts it again. Disable automatic startup persistently with `talos daemon uninstall`; re-enable it with `talos daemon install`. Disabling a Talos systemd service leaves shared user lingering intact for other services.

Each `TALOS_HOME_DIR` has a separate service identity, so development and production instances do not replace one another. Dependency installs, CI builds and npm links do not automatically register services. Managed daemons allow idle sleep; the machine reconnects after waking.

### Session recovery

Automatic session restoration is enabled by default. After a crash or restart, the daemon reconnects interrupted Claude, Codex and Muse sessions to the same Talos conversation, provider thread and working directory. It preserves the selected model and permission mode. Existing session processes survive daemon upgrades and are adopted without starting duplicates.

Explicitly archived or stopped sessions, including Ctrl-C in a terminal, stay stopped. Restoration uses checkpoints written by this CLI version; older cached sessions remain available for manual resume but are not automatically revived. Providers without a native resume adapter cannot be automatically restored.

The machine page shows restoration progress and failures, with an **Automatically restore sessions** switch. Recovery retries are bounded. If a directory or provider credential is unavailable, fix it and use **Resume Session** in the existing conversation. Disabling automatic restoration does not terminate running sessions.

Restoration reopens the agent and its saved conversation. It does not replay shell commands or automatically continue a turn interrupted during tool execution. New messages sent while the restored process connects are retained and delivered.

## Authentication

```bash
talos auth login
talos auth logout
```

Talos uses cryptographic key pairs for authentication — your private key stays on your machine. All session data is end-to-end encrypted before leaving your device.

To connect third-party agent APIs:

```bash
talos connect gemini
talos connect claude
talos connect codex
talos connect status
```

## Commands

| Command | Description |
|---------|-------------|
| `talos` | Start Claude Code session (default) |
| `talos codex` | Start Codex mode |
| `talos gemini` | Start Gemini CLI session |
| `talos openclaw` | Start OpenClaw session |
| `talos acp` | Start any ACP-compatible agent |
| `talos resume <id>` | Resume a previous session |
| `talos notify` | Send push notification to your devices |
| `talos doctor` | Diagnostics & troubleshooting |

---

## Advanced

### Environment Variables

| Variable | Description |
|----------|-------------|
| `TALOS_SERVER_URL` | Custom server URL (default: `https://api.talosapp.ai`) |
| `TALOS_WEBAPP_URL` | Custom web app URL (default: `https://talosapp.ai`) |
| `TALOS_HOME_DIR` | Custom home directory for Talos data (default: `~/.talos`) |
| `TALOS_AUTOSTART` | Set to `0` to skip automatic service setup for this invocation (use `talos daemon uninstall` for a persistent opt-out) |
| `TALOS_DISABLE_CAFFEINATE` | Disable macOS sleep prevention |
| `TALOS_EXPERIMENTAL` | Enable experimental features |

### Sandbox (experimental)

Talos can run agents inside an OS-level sandbox to restrict file system and network access.

```bash
talos sandbox configure
talos sandbox status
talos sandbox disable
```

### Building from source

```bash
pnpm install --frozen-lockfile
pnpm --filter @ahmadposten/talos-wire build
pnpm --filter talosapp build
node packages/talos-cli/bin/talos.mjs --help
```

## Requirements

- Node.js >= 20.0.0
- For Claude: `claude` CLI installed & logged in
- For Codex: `codex` CLI installed & logged in
- For Gemini: `npm install -g @google/gemini-cli` + `talos connect gemini`

## License

MIT
