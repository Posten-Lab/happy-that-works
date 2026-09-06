# Add Talos alongside the existing service

This deployment adds only `happy/talos-api` and `happy/talos-web`, with their own selectors and NodePorts 32002 and 32001. Existing Happy deployments, Services, endpoints, secrets, storage and daemon processes remain in place. The namespace and storage names are compatibility references, not new product labels.

## Verified baseline (2026-09-06)

- Context: `kubernetes-admin@kubernetes`; existing API: two healthy replicas of `ahmadposten/happy-improved-server:git-47fb413`.
- Postgres schema and all 38 migration files match deployed commit `47fb413` exactly. No migration container is included here.
- Socket.IO uses the same Redis streams adapter, `socket.io` stream, rooms and event payloads. API CORS and socket CORS both allow the new web origin.
- `happy-server-secret` provides the existing database URL, `HANDY_MASTER_SECRET` and object credentials. The Talos secret loader explicitly accepts that existing master secret. Never generate or rotate a replacement during this deployment.
- Encryption contexts retain `Happy EnCoder`, `Happy Coder`, `Happy Blobs`, `happy-server-tokens`, `handy`, and `github-happy` internally. They must remain byte-identical for old encrypted data, authentication tokens and OAuth state.
- API uses `happy-postgres:5432`, `redis://happy-redis:6379`, existing bucket `happy`, and the same MinIO NodePort 30903. No PVCs or datastores are created.
- Existing web/API/files ports remain 30082/30083/30903. New 32001/32002 were unallocated at inventory time; recheck immediately before applying.

## Prepare immutable images and backups

Build the production web export with `APP_ENV=production`, `NODE_ENV=production`, `EXPO_PUBLIC_TALOS_SERVER_URL=https://api.talosapp.ai` and `EXPO_PUBLIC_TALOS_WEBAPP_URL=https://talosapp.ai`. Package it using `deploy/web/Dockerfile.package`; build API with `Dockerfile.server`. Pin both pushed images by digest.

Existing Jenkins uses a Kaniko container (`gcr.io/kaniko-project/executor:debug`) with `jenkins/dockerhub-credentials` mounted at `/kaniko/.docker`. Its `config.json` key supplies the Docker Hub login without exposing credentials. A dedicated temporary build pod can use that existing volume plus its own workspace; pass the checked source as `--context=dir:///workspace`, the appropriate Dockerfile, and an explicit new Talos destination. Do not trigger the existing Happy Jenkins jobs or replace their images.

Before mutations, the operator must take and verify database, object-store and secret backups using the established protected backup location. Do not put secret values or backups in git. Capture the existing workload and edge configuration baseline:

```sh
kubectl config current-context
kubectl -n happy get deploy,sts,svc,pvc,pod -o wide
kubectl -n happy get deployment happy-server happy-web -o yaml > "$TALOS_BACKUP_DIR/existing-workloads.yaml"
kubectl get service -A -o jsonpath='{range .items[*]}{.metadata.namespace}{"/"}{.metadata.name}{" "}{range .spec.ports[*]}{.nodePort}{" "}{end}{"\n"}{end}'
curl --fail https://api.happy.ahposten.com/health
```

Render only after setting `TALOS_API_IMAGE` and `TALOS_WEB_IMAGE` to verified digest references. Rendering does not contact the cluster:

```sh
node deploy/talos-production/render.cjs /tmp/talos-workloads.json
kubectl apply --dry-run=server -f /tmp/talos-workloads.json
kubectl diff -f /tmp/talos-workloads.json
```

The diff must contain only the four new Talos resources. Review any existing object with these names before proceeding.

## DNS and additive edge configuration

The existing local default AWS identity is IAM user `quietplan-backend` in account `238520810352`. An administrator can attach [the limited inline policy](route53-iam-policy.json) to that user under **IAM → Users → quietplan-backend → Permissions → Add permissions → Create inline policy → JSON**, named `TalosDnsDeployment`. The existing CLI credentials then gain these permissions without generating new access keys.

The policy allows zone discovery/read access and change-status checks. Writes are restricted to CREATE/UPSERT of A records named exactly `talosapp.ai`, `api.talosapp.ai`, or `files.talosapp.ai`; it does not grant record deletion, zone creation, domain registration, or writes to other record types/names. Verify the public hosted zone's nameservers match the domain's delegation before applying the change batch. Once that zone ID is known, its administrator can further restrict the hosted-zone resource ARNs to that zone.

Edge: `jenkins-deploy@35.179.90.95`. Public upstream nodes: `89.125.50.58` and `89.125.255.36`. Certbot 2.9.0 is installed. Active nginx directories are `/etc/nginx/conf.d` and `/etc/nginx/sites-enabled`; `/etc/nginx/active` does not exist. Do not change global symlinks or copy directories with deletion enabled.

Create only the required A records (`talosapp.ai`, `api.talosapp.ai`, `files.talosapp.ai`) pointing to `35.179.90.95`, after confirming the correct hosted zone and its delegation. At inventory time the domain returned NXDOMAIN and the local AWS identity lacked Route53 list permissions; those prerequisites must be resolved before certificate issuance.

On the edge, back up nginx first, create `/var/www/talos-acme/.well-known/acme-challenge`, and install only `nginx/talos-http.conf` as `/etc/nginx/sites-enabled/talos-http`. Validate and gracefully reload nginx. The new HTTP file retains the ACME location for renewals and leaves all old hostnames alone. Verify the challenge path from outside the edge before issuing:

```sh
sudo certbot certonly --webroot -w /var/www/talos-acme \
  --cert-name talosapp.ai \
  -d talosapp.ai -d api.talosapp.ai -d files.talosapp.ai
```

This uses a webroot challenge rather than allowing Certbot to rewrite existing sites. Install `talos-upstreams.conf` into `/etc/nginx/conf.d` and `talos-tls.conf` into `/etc/nginx/sites-enabled` only after the certificate exists. The TLS configuration relies on the existing `$connection_upgrade` map. Run `sudo nginx -t` before each `sudo systemctl reload nginx`; never restart nginx for this change.

The files vhost handles CORS for `https://talosapp.ai`, answers preflight at the edge and removes `Origin` before forwarding to MinIO. It preserves the signed Host and object path, so presigned URLs continue validating. MinIO configuration and processes remain untouched. The historical bucket path remains `/happy` because renaming stored data or signed paths would break access.

## Apply and verify

Establish the files hostname and TLS first: the API checks the existing bucket during startup. Then:

```sh
kubectl apply -f /tmp/talos-workloads.json
kubectl -n happy rollout status deployment/talos-api --timeout=300s
kubectl -n happy rollout status deployment/talos-web --timeout=300s
curl --fail https://api.talosapp.ai/v1/status
curl --fail https://api.talosapp.ai/health
curl --fail --head https://talosapp.ai
curl --fail --head https://files.talosapp.ai/minio/health/live
curl --fail -i -X OPTIONS https://files.talosapp.ai/happy/verification \
  -H 'Origin: https://talosapp.ai' \
  -H 'Access-Control-Request-Method: PUT' \
  -H 'Access-Control-Request-Headers: content-type'
curl --fail https://api.happy.ahposten.com/health
kubectl -n happy get pods -o wide
```

Verify browser account restoration, existing session history, a currently connected terminal, and an encrypted attachment upload/download through the new host. Confirm old pod identities and restart counts remain unchanged. A new browser origin requires explicit account restoration; browser storage is not silently transferable between origins. Keep old URLs working for installed clients and active CLI daemons.

## Rollback without deleting state

If new checks fail, disable only the new Talos TLS vhost (move its file to the protected backup directory), validate nginx and gracefully reload. Keep old host files unchanged. Scale down only the new deployments:

```sh
kubectl -n happy scale deployment/talos-api deployment/talos-web --replicas=0
curl --fail https://api.happy.ahposten.com/health
kubectl -n happy get deployment happy-server happy-web
```

Leave Services, DNS, certificates, all secrets, Postgres, Redis, MinIO and PVCs intact for investigation and retry. Never roll back by restoring an older database over live sessions. If reattempting, repair only Talos configuration, restore its vhost and replicas, then repeat verification.

## Current staged rollout

The checked-in `staged-workloads.json` records the four running Talos resources and immutable images. It temporarily retains the existing files hostname while Route53/TLS access is pending. Follow the rollout record before applying the final template; preserve the existing services and stored keys.
