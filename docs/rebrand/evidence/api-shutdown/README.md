# API container shutdown verification

A SIGTERM during a rolling update must leave time for accepted work to finish. On September 6, 2026, an isolated container test found the pnpm/tsx CLI entrypoint exiting before a two-second shutdown handler completed. Running Node directly completed the same handler and exited with status zero.

Both tests used the actual production image `ahmadposten/talos-server@sha256:b491df5c3ca9a335c84e3bb580da067294feb8390d6d145a6f75feb45d075801` (source `73468d0a`). A read-only overlay replaced only the application entry module with [the synthetic fixture](./main.ts). It imported the image's real shutdown coordinator and logger. The candidate changed only the command to `node --import tsx ./sources/main.ts` and the working directory to `/repo/packages/talos-server`.

Each disposable Kubernetes Pod ran without production credentials, a service-account token, service links or a Service, with a read-only root filesystem and a deny-all NetworkPolicy. After a synchronous READY marker and checks of the unique Pod's UID, labels and image, the test sent SIGTERM only to PID 1 in that fixture. Synchronous markers made the result independent of buffered logging. Final logs and exit status were read before cleanup; UID/resourceVersion-guarded deletion removed the Pod before its isolation policy. No production Pod was signalled.

The [sanitized comparison](./comparison.json) records both results. The previous entrypoint received SIGTERM and began the handler, then exited with status 1 before handler completion. Direct Node completed the handler and coordinator, emitted the final shutdown log, and exited with status 0. Both fixtures were removed.

Relevant source checks also passed:

```sh
pnpm --filter @ahmadposten/talos-server exec vitest run sources/utils/shutdown.spec.ts sources/app/api/socket/socketWork.spec.ts
node --test deploy/talos-production/runtime.test.cjs
```

These are 11 shutdown/socket-work tests and three production configuration tests. The isolated image test verifies signal delivery and the real coordinator with synthetic pending work; it does not generate production writes or claim to simulate every dependency outage. Production image delivery, startup health and revision checks are recorded in the release PR.
