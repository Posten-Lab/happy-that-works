# Canonical MacBook and Dell CLI installation

This is the execution runbook for the already authorized registry installation and connection of both machines. Run it only after the four npm packages have been published and a clean registry installation has passed. The prepared CLI version is `talosapp@1.0.0`; wire is `@ahmadposten/talos-wire@0.1.0`. Confirm the actual published versions and registry integrity values in the release record before executing.

## Verified starting state

| Machine | npm and global prefix | Node available to a normal command | Existing installation |
| --- | --- | --- | --- |
| MacBook | `/opt/homebrew/bin/npm`, `/opt/homebrew` (user writable) | 25.1.0 | Candidate commands in `~/.local/bin`; migrated Talos account, 40 cached keys, public Talos URLs; no Talos daemon |
| Dell, `ubuntu@100.112.247.83` | `/usr/bin/npm`, `/usr` (`sudo -n` available) | 20.20.1 | Happy 1.1.11, 17 cached sessions; no Talos command or home |

Both machines already use the same account. Their existing Happy daemons remain online. Dell also has an active Codex session and its MCP process; its running processes use NVM Node 24.20.0. Both available command runtimes satisfy the inspected CLI dependencies, including the Node 20.19 minimum of the installed hash library. Verify the actual registry graph on each platform before activation because transitive dependency ranges can change.

Neither machine has `PNPM_HOME` or a usable `pnpm bin -g` configured. Standard npm global installation follows the user's requested installation method and existing PATH; it requires no shell profile changes. Maintainer builds/publication continue to use pnpm.

## Protect state and check registry artifacts

Use a separate private backup on each machine before any installation or migration. From that machine's user account:

```sh
TALOS_INSTALL_BACKUP=$(mktemp -d "$HOME/.talos-install-backup.XXXXXX")
chmod 700 "$TALOS_INSTALL_BACKUP"
python3 - "$TALOS_INSTALL_BACKUP" <<'PY'
import hashlib, json, os, shutil, sys
from pathlib import Path
destination = Path(sys.argv[1]); manifest = {}
for brand in ['happy', 'talos']:
    source = Path.home() / ('.' + brand)
    target = destination / brand
    target.mkdir(mode=0o700)
    for name in ['access.key', 'agent.key', 'settings.json', 'sessions.json',
                 'imported-session-keys.json', 'account-migration.json', 'daemon.state.json']:
        item = source / name
        if item.is_symlink() or (item.exists() and not item.is_file()):
            raise SystemExit('Unexpected account file type; inspect before installation.')
        if item.is_file() and not item.is_symlink():
            saved = target / name
            shutil.copyfile(item, saved); saved.chmod(0o600)
            manifest[brand + '/' + name] = hashlib.sha256(saved.read_bytes()).hexdigest()
(destination / 'hashes.json').write_text(json.dumps(manifest, indent=2))
(destination / 'hashes.json').chmod(0o600)
print('Private state backup created.')
PY
npm view talosapp@1.0.0 version dist.integrity --json --registry=https://registry.npmjs.org
npm view @ahmadposten/talos-wire@0.1.0 version dist.integrity --json --registry=https://registry.npmjs.org
```

Record current command link targets and daemon/session process identities privately. Compare original `access.key` and `settings.json` with their backup after every phase. Live session caches and daemon heartbeats can legitimately advance; preserve their keys and active processes instead of demanding an unchanged heartbeat file. Backups are evidence, not files to restore over a running installation.

Before global installation, install the exact registry CLI in a fresh temporary prefix on each platform and run `bin/talos --version` with a temporary `TALOS_HOME_DIR`. Verify its CLI/wire versions, tool unpacking and optional server-peer absence using the release packaging checks. Do not install the separate server or agent package on these client machines merely to make the CLI work.

## Install and activate the canonical command

On the MacBook:

```sh
/opt/homebrew/bin/npm install -g --prefix /opt/homebrew \
  --registry=https://registry.npmjs.org talosapp@1.0.0
/opt/homebrew/bin/talos --version
```

The existing candidate links precede Homebrew on PATH. Remove only the two links owned by this rollout, after checking both targets and the canonical binary. The following aborts before removal if either link changed:

```sh
python3 - <<'PY'
from pathlib import Path
import os
candidate = Path.home() / '.local/share/talos/releases/1.0.0-candidate-02cb264efff1'
links = [(Path.home()/'.local/bin'/name, candidate/'node_modules/talosapp/bin'/file)
         for name, file in [('talos', 'talos.mjs'), ('talos-mcp', 'talos-mcp.mjs')]]
for link, expected in links:
    if not link.is_symlink() or Path(os.readlink(link)) != expected:
        raise SystemExit('Activation link changed; preserved without removal.')
for name in ['talos', 'talos-mcp']:
    binary = Path('/opt/homebrew/bin') / name
    if not binary.exists() or 'talosapp' not in str(binary.resolve()):
        raise SystemExit('Canonical npm command is missing; candidate preserved.')
for link, _ in links:
    link.unlink()
print('Owned candidate links removed; immutable release directory retained.')
PY
hash -r
command -v talos
command -v talos-mcp
talos --version
```

Expected paths are `/opt/homebrew/bin/talos` and `/opt/homebrew/bin/talos-mcp`. Keep the candidate directory and its copied tarballs; do not uninstall or delete it while any process might reference its code.

On Dell, connect through the already trusted SSH host and install only the new package:

```sh
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes ubuntu@100.112.247.83
sudo -n /usr/bin/npm install -g --prefix /usr \
  --registry=https://registry.npmjs.org talosapp@1.0.0
/usr/bin/talos --version
hash -r
command -v talos
command -v talos-mcp
```

Expected paths are `/usr/bin/talos` and `/usr/bin/talos-mcp`. If any Talos command/package appears before these steps, inspect it and stop this initial-install sequence instead of overwriting an unreviewed installation. The existing Happy commands/packages are separate and stay installed. Do not run `install-local.cjs`, `cli:install`, `doctor clean`, or an npm unlink/uninstall operation for Happy.

## Import and connect

Use explicit URLs and home directories. On Mac, refresh only the additional historical-key index; the account is already migrated:

```sh
TALOS_HOME_DIR="$HOME/.talos" /opt/homebrew/bin/talos migrate \
  --from "$HOME/.happy" --server-url https://api.talosapp.ai \
  --webapp-url https://talosapp.ai --import-session-keys --dry-run
TALOS_HOME_DIR="$HOME/.talos" /opt/homebrew/bin/talos migrate \
  --from "$HOME/.happy" --server-url https://api.talosapp.ai \
  --webapp-url https://talosapp.ai --import-session-keys
```

On Dell, import the original account and cached keys into a new Talos identity:

```sh
TALOS_HOME_DIR="$HOME/.talos" /usr/bin/talos migrate \
  --from "$HOME/.happy" --server-url https://api.talosapp.ai \
  --webapp-url https://talosapp.ai --dry-run
TALOS_HOME_DIR="$HOME/.talos" /usr/bin/talos migrate \
  --from "$HOME/.happy" --server-url https://api.talosapp.ai \
  --webapp-url https://talosapp.ai
```

The CLI preview may create an empty Talos home/log directory through configuration initialization; it does not import credentials or daemon state. The real import creates a separate machine identity and preserves the original account files. Never copy `daemon.state.json`, its lock, or `sessions.json` into the Talos home. Imported historical keys belong in the separate private index and do not assign active session ownership to the new daemon.

Immediately before starting a daemon, verify in memory that both account identities agree, the machine identities differ, Talos uses the public URLs, and the Talos home has no daemon state, daemon lock, or live `sessions.json`. Abort on unexpected state; `daemon start` can replace a different-version daemon in its selected home.

Start as the normal user, with an explicit Talos home and public endpoint. Do not use sudo for daemon startup:

```sh
TALOS_HOME_DIR="$HOME/.talos" TALOS_SERVER_URL=https://api.talosapp.ai \
  TALOS_WEBAPP_URL=https://talosapp.ai talos daemon start
```

On Dell, `/usr/local/bin` already exposes Claude and Codex to the normal SSH PATH. Preserve the existing process runtime and provider configuration. If matching the existing daemon's CLI discovery is necessary, its verified PATH is `$HOME/.local/bin:$HOME/.nvm/versions/node/v24.20.0/bin:/usr/local/bin:/usr/bin:/bin`; use it only after checking that no Talos shadow command was introduced. The Node 20 global command and existing Node 24 session processes can coexist.

`daemon start` waits about five seconds for local state; a slow authenticated connection can finish later. A nonzero exit is a reason to inspect the newly created state and process, not to issue another start blindly. Local state alone is not proof of server connectivity.

## Verify both machines and the original session

Copy the reviewed `scripts/verify-cli-continuity.cjs` to a private operator location on Dell, or use the reviewed checkout on that machine. This script reads credentials only in memory and outputs booleans/counts. Before activation it accepts `--before`; after activation use:

```sh
node /path/to/verify-cli-continuity.cjs /opt/homebrew/lib/node_modules/talosapp --connected
# On Dell:
node /path/to/verify-cli-continuity.cjs /usr/lib/node_modules/talosapp --connected
```

Require authenticated machine lookup, both old and new machines online, separate live daemon processes, zero adopted sessions in the new daemon, encrypted read-only RPC to both machines, and encrypted read-only RPC to an existing active session. Run immediately after activation, before the user starts new Talos sessions. The verifier sends only `listDirectory` RPCs and never prints account tokens, encryption keys, or session identifiers. Also confirm both new machine entries appear online in the already restored Talos app and the original open conversation continues updating. Do not use `talos auth status` for this check: it prints a token prefix and can clean stale daemon state.

## Recovery

If installation or verification fails, retain all account directories, backups, package trees and original processes. Do not restore the old database, copy the old daemon state, or kill an active session.

Before a new daemon has started, Mac command rollback may exclusively recreate the two recorded candidate links if absent; never overwrite a changed link. On Dell, leaving the new package installed and dormant preserves the original workflow. After the new daemon has started, retain its exact installed code while investigating. Stop only that newly created daemon after checking its recorded PID, Talos home and absence of new user sessions; this is a separately reviewed recovery action, not an automatic step in this runbook. Existing Happy daemons and active sessions remain running throughout.
