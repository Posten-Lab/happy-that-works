# Linux service and recovery E2E

These tests use actual systemd/OpenRC supervision, the packed Talos CLI, a disposable seeded Talos relay account, and authenticated Claude/Codex providers. They must run in disposable containers, never against a developer's usual Talos home or host service manager.

Build the CLI and run `pnpm --filter talosapp pack --pack-destination /tmp/talos-service-package` while no other process is rebuilding `dist`. Keep the resulting tarball immutable throughout a run. Build the two images from this directory:

```sh
docker build -f linux-systemd.Dockerfile -t talos-service-e2e-systemd .
docker build -f linux-openrc.Dockerfile -t talos-service-e2e-openrc .
docker run -d --name talos-service-e2e-systemd --hostname talos-systemd-e2e \
  --privileged --cgroupns=private --network host --tmpfs /run --tmpfs /run/lock --tmpfs /tmp \
  talos-service-e2e-systemd
docker run -d --name talos-service-e2e-openrc --hostname talos-openrc-e2e \
  --network host --tmpfs /run --tmpfs /tmp talos-service-e2e-openrc
```

The systemd container needs a writable private cgroup namespace. Do not bind-mount host `/run` or `/sys/fs/cgroup`. Both containers have a separate `talos` account and test-only sudo access. Their host networking allows a loopback SSH reverse tunnel to a disposable relay; no network configuration services are enabled. OpenRC runs its real default runlevel and supervisor, with cgroup management disabled for the container.

For each container:

1. Copy the tarball, `client.cjs`, and `linux-verify.cjs` into `/artifacts`.
2. As user `talos`, install it with `npm install -g --foreground-scripts /artifacts/talosapp-1.0.4.tgz`, setting `HOME=/home/talos`, `npm_config_prefix=/home/talos/.local`, and the disposable `TALOS_SERVER_URL`/`TALOS_WEBAPP_URL`. Leave `XDG_RUNTIME_DIR` unset to exercise automatic runtime-bus discovery. Check that npm's hook created an active service before any coding session runs; systemd must report `Linger=yes`.
3. Seed account configuration before its credential file: write `/home/talos/.talos/settings.json` with a **new random machineId**, and the disposable relay URLs; then privately copy its `access.key`. Use mode `0600` and ownership `talos:talos`. Never print or attach these files.
4. Install actual provider CLIs as `talos`, using the same npm prefix. Privately copy authorized test provider credentials to `.claude/.credentials.json` and `.codex/auth.json`, also `0600` and owned by `talos`. Create `/home/talos/project` owned by that user.
5. Run `talos auth login` as `talos`. This exercises the already-connected account setup path without requiring a terminal coding session.
6. Run the harness below. Its `prepare` mode uses the same encrypted relay RPC/messages as the UI, starts both providers, checks actual replies, kills only the daemon, and verifies that the restarted daemon adopts the existing provider processes without duplicates.

```sh
docker exec --user talos -e HOME=/home/talos \
  -e NODE_PATH=/home/talos/.local/lib/node_modules/talosapp/node_modules \
  talos-service-e2e-systemd node /artifacts/linux-verify.cjs prepare
docker restart --timeout 15 talos-service-e2e-systemd
docker exec --user talos -e HOME=/home/talos \
  -e NODE_PATH=/home/talos/.local/lib/node_modules/talosapp/node_modules \
  talos-service-e2e-systemd node /artifacts/linux-verify.cjs after-reboot
```

Repeat with `talos-service-e2e-openrc`. `after-reboot` asserts automatic recovery of the same Talos session IDs and provider thread IDs, immediately sends another prompt as soon as the recovered process is visible, and requires a real provider reply. This intentionally exercises the reconnect/message-arrival race rather than delaying until recovery has settled.

Finally run `linux-verify.cjs stop`, restart the container again, then run `linux-verify.cjs after-stop-reboot`. These modes use the real stop-session RPC and assert that deliberate stops remain stopped across boot and repeated recovery scans.

Run `linux-verify.cjs pause-daemon` to verify that the app's stop-daemon RPC keeps the machine offline through the supervisor's restart window. In the OpenRC test container, temporarily removing its test sudoers file also exercises this behavior without administrative authorization and checks that an already-running service does not request another authorization during `talos auth login`.

The boot test restarts the container's complete process namespace and service manager; it does not reboot the Docker host or change the host kernel boot ID. Record that distinction in evidence. Keep the harness's stdout and `/artifacts/linux-results.json`; they contain identifiers and outcomes, not credentials or encryption keys. Remove both containers, any copied private files and the SSH tunnel after capturing results.
