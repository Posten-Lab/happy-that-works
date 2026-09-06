# Talos Agent

CLI client for controlling Talos agents remotely.

Unlike `talos-cli` which both runs and controls agents, `talos-agent` only controls them — listing machines, spawning sessions on a machine, creating sessions, sending messages, reading history, monitoring state, and stopping sessions.

## Installation

From the monorepo:

```bash
yarn workspace talos-agent build
```

Or link globally:

```bash
cd packages/talos-agent && npm link
```

## Authentication

Talos Agent uses account authentication via QR code, the same flow as linking a device in the Talos mobile app.

```bash
# Authenticate by scanning QR code with the Talos mobile app
talos-agent auth login

# Check authentication status
talos-agent auth status

# Clear stored credentials
talos-agent auth logout
```

Credentials are stored at `~/.talos/agent.key`.

## Commands

### List sessions

```bash
# List all sessions
talos-agent list

# List only active sessions
talos-agent list --active

# Output as JSON
talos-agent list --json
```

### List machines

```bash
# List all machines
talos-agent machines

# List only active machines
talos-agent machines --active

# Output as JSON
talos-agent machines --json
```

### Spawn on a machine

```bash
# Spawn a session on a specific machine
talos-agent spawn --machine <machine-id> --path ~/project

# Let the daemon create the directory if needed
talos-agent spawn --machine <machine-id> --path ~/new-project --create-dir

# Choose a specific agent
talos-agent spawn --machine <machine-id> --path ~/project --agent codex

# Output as JSON
talos-agent spawn --machine <machine-id> --path ~/project --json
```

### Session status

```bash
# Get live session state (supports ID prefix matching)
talos-agent status <session-id>

# Output as JSON
talos-agent status <session-id> --json
```

### Create a session

```bash
# Create a new session with a tag
talos-agent create --tag my-project

# Specify a working directory
talos-agent create --tag my-project --path /home/user/project

# Output as JSON
talos-agent create --tag my-project --json
```

### Send a message

```bash
# Send a message to a session
talos-agent send <session-id> "Fix the login bug"

# Send with yolo permissions
talos-agent send <session-id> "Ship it" --yolo

# Send and wait for the agent to finish
talos-agent send <session-id> "Run the tests" --wait

# Output as JSON
talos-agent send <session-id> "Hello" --json
```

### Message history

```bash
# View message history
talos-agent history <session-id>

# Limit to last N messages
talos-agent history <session-id> --limit 10

# Output as JSON
talos-agent history <session-id> --json
```

### Stop a session

```bash
talos-agent stop <session-id>
```

### Wait for idle

```bash
# Wait for agent to become idle (default 300s timeout)
talos-agent wait <session-id>

# Custom timeout
talos-agent wait <session-id> --timeout 60
```

Exit code 0 when agent becomes idle, 1 on timeout.

## Environment Variables

- `TALOS_SERVER_URL` - API server URL (default: `http://localhost:3005`)
- `TALOS_HOME_DIR` - Home directory for credential storage (default: `~/.talos`)

## Session ID Matching

All commands that accept a `<session-id>` support prefix matching. You can provide the first few characters of a session ID and the CLI will resolve the full ID.

Machine-aware commands such as `spawn --machine <machine-id>` also support ID prefix matching.

## Encryption

All machine and session data is end-to-end encrypted. New records use AES-256-GCM with per-record keys. Existing records created by other clients are decrypted using the appropriate key scheme (AES-256-GCM or legacy NaCl secretbox).

## Requirements

- Node.js >= 20.0.0
- A Talos mobile app account for authentication

## Preparing a release

Publication is disabled until the Talos package namespace and repository are confirmed. The package is private, and `.release-it.json` disables release commits, tags, pushes, GitHub releases, and npm publication. Maintainers must configure the confirmed Talos destinations and deliberately enable these actions before releasing.

For local verification, run `pnpm --filter talos-agent build` and `pnpm --filter talos-agent test`. See [the rebrand release requirements](../../docs/rebrand/README.md).

## License

MIT
