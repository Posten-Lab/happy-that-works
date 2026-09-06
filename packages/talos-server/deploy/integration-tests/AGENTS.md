# Integration Tests

Stress tests that run against a real multi-replica Talos server on minikube.

## Prerequisites

- minikube
- kubectl
- docker
- node 20+ with `socket.io-client`, `tweetnacl`, `ioredis` available

## Start local cluster

```bash
bash local.sh
```

This builds the server image, applies the kustomize overlay (2-replica server + Postgres + Redis + MinIO), runs Prisma migrations, and rolls out the deployment.

After it finishes, open a tunnel to the service:

```bash
minikube service --namespace talos-integration talos-server --url
```

Use the printed URL as `SERVER_URL` for the tests below. If port-forwarding instead:

```bash
kubectl --namespace talos-integration port-forward svc/talos-server 3005:3000
# SERVER_URL=http://127.0.0.1:3005
```

## Run all tests (recommended)

```bash
./run-all.sh              # run all tests (cluster must be deployed)
./run-all.sh --deploy     # build, deploy, then run all tests
./run-all.sh --safe-only  # skip pod-killing tests
```

Handles port-forwards, Redis tunnel, pod recovery between destructive tests, and prints a summary. This is the one-click way.

## Automated tests (run via run-all.sh)

These tests work with `kubectl --namespace talos-integration port-forward` and are run automatically by `run-all.sh`.

All tests accept `SERVER_URL` env var (defaults to `http://127.0.0.1:3000`).

### Prod-realistic stress (stream pressure + RPC reliability)

```bash
SERVER_URL=http://<tunnel-url> node stress-prod-realistic.mjs [entries_per_sec]
```

Default rate: 5000 entries/sec.

### RPC registration (safe scenarios)

```bash
SERVER_URL=http://<tunnel-url> node stress-rpc-registration.mjs <scenario|all>
```

`all` runs the port-forward-safe scenarios: `fire-and-forget`, `register-race-timing`, `reconnect-no-ack`, `rapid-sessions`, `ios-session-flow`, `high-concurrency`, `cross-replica-3pod`.

### Dead-daemon detection (per-pod port-forwards)

```bash
SERVER_URL=http://<tunnel-url> node test-rpc-dead-daemon.mjs
```

Kills a pod but sets up per-pod port-forwards so the test survives the pod death. This is the canonical pod-kill test.

## Manual tests (NOT port-forward compatible)

These tests kill pods, which breaks the shared `kubectl --namespace talos-integration port-forward` that run-all.sh and most manual setups use. They must be run individually, ideally through a stable ingress or `minikube service` URL rather than port-forward.

### RPC registration (pod-kill scenarios)

```bash
SERVER_URL=http://<tunnel-url> node stress-rpc-registration.mjs rolling-deploy
SERVER_URL=http://<tunnel-url> node stress-rpc-registration.mjs stale-room-cleanup
SERVER_URL=http://<tunnel-url> node stress-rpc-registration.mjs server-rolling-restart
```

These are excluded from `all` because they kill pods. `test-rpc-dead-daemon.mjs` covers the core pod-kill detection case.

### Sync degradation and recovery

```bash
SERVER_URL=http://<tunnel-url> node stress-sync-degradation.mjs <scenario|all>
```

Scenarios: `full-server-outage`, `reconnect-connect-err`, `rpc-after-reconnect`, `cascading-disruption`. ALL scenarios kill pods, so none work through port-forward. `test-rpc-dead-daemon.mjs` covers the core pod-kill detection scenario.

## Useful kubectl --namespace talos-integration commands

```bash
# Watch pods
kubectl --namespace talos-integration get pods -w

# Tail server logs
kubectl --namespace talos-integration logs -l app=talos-server --all-containers -f

# Kill a specific pod (for pod-kill scenarios)
kubectl --namespace talos-integration delete pod <pod-name> --grace-period=0

# Restart deployment
kubectl --namespace talos-integration rollout restart deployment/talos-server

# Access Redis CLI
kubectl --namespace talos-integration exec -it talos-redis-0 -- redis-cli

# Access MinIO console
kubectl --namespace talos-integration port-forward svc/talos-minio 9001:9001
# then open http://localhost:9001 (minioadmin/minioadmin)
```
