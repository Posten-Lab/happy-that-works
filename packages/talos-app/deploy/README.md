# Local Talos web deployment

`talos-app.yaml` is a local-only manifest retained for existing references. It requires a pre-created `talos` namespace and a locally loaded `talos-web:local` image; it never pulls from the previous product's registry.

Production deployment uses the validated templates and Jenkins pipeline in [`deploy/web`](../../../deploy/web). Configure the Talos hosts and ports described in [the rebrand release requirements](../../../docs/rebrand/README.md).

OTA releases use `pnpm --filter talos-app ota` for preview and `pnpm --filter talos-app ota:production` for production. The release wrapper passes the selected `APP_ENV` to configuration validation, changelog generation, type checking, and EAS. `OTA_MESSAGE` is passed as a literal argument. Any failed local step stops publication.
