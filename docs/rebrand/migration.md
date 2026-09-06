# Keep existing sessions available in Talos

`talos migrate` imports the account credentials from an existing local installation. It preserves the account token, encryption keys, and configured relay. Existing sessions continue on their original daemon and appear when the Talos app connects to that same account and relay. Link or restore the account in the Talos app to access it there.

Preview before importing:

```sh
talos migrate --dry-run
talos migrate
```

Use `--from DIR` to select the source installation and `TALOS_HOME_DIR` to select an empty destination. `--server-url URL` and `--webapp-url URL` explicitly select relay endpoints; use replacement endpoints only after verifying that they serve the same account backend. The command checks conflicting Talos environment overrides and refuses a relay change between preview and import.

The import copies `access.key` and a matching `agent.key`, when present, byte for byte. It assigns a new machine ID and carries the saved relay and applicable preferences. It does not copy daemon state, process locks, or the local session cache. Running sessions remain attached to the original machine, while new Talos sessions use the separate machine identity. It never stops or restarts processes and never overwrites a conflicting Talos account.

When valid cached session keys exist, migration creates a separate private `imported-session-keys.json` index containing only session IDs, encryption keys, and formats. It is bound to the imported account and migration receipt, and never establishes daemon ownership. An already migrated account can add or extend the index with `talos migrate --import-session-keys`; credentials, settings, and the migration receipt remain unchanged. Registration confirmation, token renewal, and updated relay preferences are supported while the account and machine identity still match. Each import holds its own exclusive lock, preserves all prior keys, and adds new session IDs atomically. A different key for an existing session causes the whole update to stop without replacing the index.

`talos resume <session-id>` can use this index without `agent.key`: it first fetches sessions using the current account token, then decrypts the matching session's latest server metadata to recover its working path and provider session ID. Keys are never sent to the relay. Changing to an explicitly configured alias of the same backend remains possible because session access and ciphertext are authenticated rather than relying on hostname equality. Uncached history still requires authentication with the account master secret; a CLI token alone cannot decrypt it. The index does not recover a missing account master secret or grant access to another account. An active session is left running; CLI resume refuses to start a duplicate agent.

Files are staged with private permissions and installed exclusively, with `access.key` installed last. Ordinary write failures trigger rollback of files installed by that invocation. This is not a crash-atomic multi-file transaction: a forced termination or power loss can leave a partial destination and a migration lock. The source installation remains available and unchanged. If an interrupted import prevents retrying, preserve that destination and rerun against a new, empty `TALOS_HOME_DIR`; do not delete another installation's credentials or process state to force the import.
