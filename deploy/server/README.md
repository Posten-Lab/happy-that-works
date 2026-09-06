# Talos relay deployment

The relay deployment templates run the API, PostgreSQL, Redis, and MinIO in the `talos` namespace. Use the [deployment guide](../README.md) to configure new Talos hostnames, node hosts, and allocated service ports before rendering or applying them.

| Files | Purpose |
| --- | --- |
| `k8s/postgres.yaml` | PostgreSQL and its persistent volume |
| `k8s/redis.yaml` | Redis and event distribution between API replicas |
| `k8s/minio.yaml`, `k8s/minio-setup-job.yaml` | Object storage, private Talos bucket, and configured web origin |
| `k8s/deployment.yaml`, `k8s/service.yaml` | API replicas, database migrations, health probes, and configured NodePort |
| `k8s/secret.example.yaml` | Shape of the separately provisioned server secret |
| `nginx/` | API WebSocket proxy and attachment hosting templates |

Render into `deploy/rendered/server` and review those generated files. Configure the persistent volumes and node scheduling for the chosen cluster. Preserve the master secret together with the data: replacing it changes token verification and encrypted server data keys.

Set `TALOS_SERVER_URL` for the CLI and `EXPO_PUBLIC_TALOS_SERVER_URL` for app builds. Development defaults point to a local relay. No production endpoint or store identity is inferred from the Talos name.

After an authorized deployment, verify `/health`, `/v1/status`, WebSocket connectivity, and an encrypted attachment upload/download using the configured hostnames. The rebrand work did not apply these manifests.
