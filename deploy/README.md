# Talos deployment

These are templates for a separate Talos installation. Deployment requires operator-controlled domains, newly allocated service ports, a Talos namespace, image repositories, and mobile distribution identities. No deployment has been performed as part of the rebrand. See [the verification report](../docs/rebrand/README.md).

## Web and API configuration

Start with [`.env.talos.example`](../.env.talos.example). Configure the HTTPS web and API URLs, `TALOS_WEB_HOST`, `TALOS_API_HOST`, `TALOS_FILES_HOST`, two node hosts, and three unused NodePorts in the range 30000–32767. The hostname and port values must describe the new Talos services.

Render the manifests into a separate output directory:

```sh
node scripts/verify-release-config.cjs web
node scripts/render-deployment.cjs deploy/web/k8s deploy/rendered/web
node scripts/render-deployment.cjs deploy/server/k8s deploy/rendered/server
node scripts/render-deployment.cjs deploy/web/nginx deploy/rendered/web-nginx
node scripts/render-deployment.cjs deploy/server/nginx deploy/rendered/server-nginx
```

Rendering validates every input before writing any output. Review the rendered services, volumes, image names, and nginx upstreams before applying them. Native nginx variables such as `$host` are preserved.

The web image serves the Expo export. The server image runs the API with PostgreSQL, Redis, and object storage. Provision the `talos` namespace and the server secret separately; Jenkins does not create or read the secret. Keep the master secret and database/storage backups together when restoring an installation.

The pipelines under `web/` and `server/` use the configured Jenkins SCM checkout. Their agent scheduling, image repository names, registry credentials, service account, and permissions are operator-specific settings that must be reviewed before enabling a job. Configure TLS certificates for the chosen hostnames before activating nginx routes.

## Mobile distribution

The application IDs are `com.ahposten.talos` for production, with `.dev` and `.preview` variants. Create separate Talos store listings and a new EAS project. Configure `TALOS_EAS_PROJECT_ID`, `TALOS_EXPO_OWNER`, the production service URLs, and Firebase configuration matching the Talos Android package. Set the App Store Connect submission identity in `packages/talos-app/eas.json` for the new listing.

`mobile/Jenkinsfile` builds and submits an iOS production artifact after the release preflight. Its Expo token, Apple team, and App Store Connect credentials must be configured for the intended Talos publisher. Do not enable submission until the new store records and signing configuration have been verified. Development simulator builds do not require these production credentials.

## Local integration infrastructure

`packages/talos-server/deploy/overlays/local` renders into the isolated `talos-integration` namespace with the locally built `talos-server:local` image. Its integration runner can restart or remove its test pods; inspect the requested tests and cluster context before running it. The runner cleans up only the forwarding processes it starts.

The rebrand verification rendered these manifests without applying them or running the cluster stress tests.
