# Talos runtime availability

The production workload template continues to render only the two Talos Deployments and Services in the existing `happy` namespace. Existing database, Redis, MinIO, secrets, bucket names and all earlier deployments remain unchanged. `disruptions.json` adds a separate PodDisruptionBudget for each Talos Deployment, requiring one available replica during voluntary eviction.

Both two-replica workloads require different Kubernetes hostnames. Four non-CI nodes were Ready during the September 6 rollout review. With `maxSurge: 1` and `maxUnavailable: 0`, a rolling update needs a third eligible node; verify capacity before deployment. If only two eligible nodes remain, the update intentionally waits while keeping both old replicas rather than co-locating replicas. A PDB does not prevent involuntary node failure.

New pods must remain ready for ten seconds before replacing an old pod. Startup allows up to five minutes. API liveness checks `/v1/status`, a process-only route; dependency outages affect `/health` readiness without restarting an otherwise responsive process. Readiness checks Postgres and the actual Redis streams connection, finishes within 2.5 seconds, and fails during shutdown. Talos API pods retain the existing Prometheus scrape annotations on port 9090.

Termination first gives endpoint removal ten seconds to reach proxies. The API then closes HTTP and Socket.IO transports, waits for pending work and activity-cache updates, and finally closes database and Redis resources. Shutdown has a 45-second overall deadline inside the 60-second Kubernetes termination grace. Reconnecting clients retain their account and encrypted session state; no existing CLI daemon is restarted by this configuration.

The API image runs `node --import tsx ./sources/main.ts` directly from the server package directory. Node must be PID 1: an isolated test of the previous pnpm/tsx CLI entrypoint showed it exiting before a two-second shutdown handler completed. With the same image and fixture, the direct Node entrypoint completed the handler, returned from the shutdown coordinator and exited successfully. Preserve this entrypoint when changing the image or workload commands.

Build and verify a new immutable API image before applying this template: the readiness and shutdown behavior includes source changes. Save the currently deployed Talos manifests for rollback, render with verified API/web digests, and review server-side dry runs for the four workloads plus `disruptions.json`. Apply only these Talos resources, wait for both rollouts, then verify each replica is on a distinct node, both PDBs allow one disruption, public web/API/files checks pass, and old deployment pod identities/restart counts remain unchanged. Do not drain a node or delete live session pods merely to test availability.

Targeted checks:

```sh
node --test deploy/talos-production/runtime.test.cjs
pnpm --filter @ahmadposten/talos-server test
pnpm --filter @ahmadposten/talos-server typecheck
```
