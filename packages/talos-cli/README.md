# Talos

Code on the go — control AI coding agents from your phone, browser, or terminal.

Free. Open source. Code anywhere.

## Installation

```bash
npm install -g talosapp
```

The npm package is `talosapp`; the command is `talos`. Open [talosapp.ai](https://talosapp.ai) to connect your browser or phone.

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
talos daemon stop
talos daemon status
talos daemon list
```

The daemon starts automatically when you run `talos`, so you usually don't need to manage it manually.

### Keeping the daemon running across reboots

If you want the daemon to come back automatically after a reboot — without opening a `talos` session first — start it from your shell profile so it inherits your normal user session context (PATH, keychain access, OAuth credentials):

```bash
# ~/.zshrc or ~/.bashrc
if [[ -o interactive ]] && [[ -z "$TALOS_DAEMON_CHECKED" ]]; then
    export TALOS_DAEMON_CHECKED=1
    () {
        local state=$HOME/.talos/daemon.state.json
        local pid=$(grep -oE '"pid"[[:space:]]*:[[:space:]]*[0-9]+' "$state" 2>/dev/null | grep -oE '[0-9]+')
        if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
            talos daemon start >/dev/null 2>&1
        fi
    } &!
fi
```

The first interactive shell after a reboot triggers the start; subsequent shells short-circuit because the daemon is already running.

> **macOS users:** prefer this shell-init approach over a `launchd` LaunchAgent. A LaunchAgent runs in an agent domain that is **detached from your GUI/Aqua login session**, which means the bundled `claude-agent-sdk` cannot reach the macOS keychain and silently fails authentication ("Failed to authenticate. API Error: 401 terminated", `duration_api_ms: 0`). If you must use launchd, your wrapper has to read the OAuth access token from `~/.claude/.credentials.json` and export it as `CLAUDE_CODE_OAUTH_TOKEN` before exec'ing the daemon — and you'll need to handle token rotation yourself.

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
