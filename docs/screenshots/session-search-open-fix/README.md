# Archived search result opening: native E2E

Validated 2026-09-12 on an iPhone 17 Pro simulator running iOS 26.1, against the actual authenticated `https://api.happy.ahposten.com` service. The dedicated synthetic account contained four encrypted sessions and 136 messages; the tested archive contained 132 messages with the match at sequence 3. No user conversation content or credentials are included.

The older service returns HTTP 404 for `GET /v1/sessions/:id`, although its authenticated paginated `/v2/sessions` endpoint returns the session. The current `https://api.talosapp.ai` service returns HTTP 200 from the single-session endpoint. The real API probe exercised the actual `getSearchSession` helper on both services; see [API results](api-evidence.json).

## Native before and after

A private copy of the installed Talos development simulator shell (`com.ahposten.talos.dev`, updates disabled) received Hermes bundles exported from the pre-fix search source and then the fixed source. The same simulator, synthetic account and real legacy service were used for both runs. This validates native interactions with actual services; it is not a TestFlight IPA installation or OTA receipt test. The fix changes no native dependencies.

- Before: searching `copper lantern` and tapping `Synthetic release workflow` reproduced the reported error. [Screenshot](native-before-fix.png)
- After: tapping the same title opened the archived conversation and loaded its messages. [Screenshot](native-after-open.png)
- After: tapping the matching excerpt opened the conversation at sequence 3, with `session-search-target` visible and the exact user text highlighted. [Screenshot](native-after-match.png)

The included Maestro flows record the UI assertions. Each ran with `JAVA_HOME` pointing to the installed Android Studio JBR and `maestro --device <review-simulator> test <flow> --debug-output <private-directory>`. The match flow starts on the search screen and clears the retained query before entering it again. Its initial automated attempt appended to the retained query; the corrected run passed. The title and excerpt flows both completed with exit 0.

Bundle command, from each app source directory (absolute entry path required):

```sh
APP_ENV=development EXPO_PUBLIC_TALOS_SERVER_URL=https://api.happy.ahposten.com \
EXPO_PUBLIC_TALOS_WEBAPP_URL=https://talosapp.ai EXPO_NO_TELEMETRY=1 \
pnpm exec expo export:embed --entry-file <absolute-app-directory>/index.ts \
  --platform ios --dev false --bytecode \
  --bundle-output <private-shell>/main.jsbundle --assets-dest <private-shell> --max-workers 4
codesign --force --deep --sign - <private-shell>
xcrun simctl install <review-simulator> <private-shell>
```

Additional checks: `pnpm exec vitest run --maxWorkers=4` passed all 832 tests in 79 files; `pnpm typecheck` passed; `git diff --check` passed. New tests cover modern lookup, legacy pagination beyond 200 sessions, deleted sessions, authorization/server/abort failures, cursor termination, metadata refresh and exact-message loading.
