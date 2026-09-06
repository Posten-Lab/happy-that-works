# Talos 2.0.0: update the installed mobile app

The production mobile release updates the existing user-owned store app in place. Its visible name, icon, splash screens, and interface become Talos. Development and preview builds retain separate Talos application identifiers.

Production retains iOS bundle and Android package `com.ahposten.happyimproved`. These hidden identifiers are centralized in `packages/talos-app/store-identity.cjs`. Apple requires the uploaded bundle identifier to match the existing App Store Connect record and does not allow changing that record's identifier after upload. See [Apple's bundle identifier requirements](https://help.apple.com/xcode/mac/current/en.lproj/deve21d0239c.html).

The production submission remains App Store Connect app `6787151946`, Apple team `H2XR8XWZXW`, and owned EAS project `4445e993-5eaa-4a1a-8754-7068e8565e64` under `posten-lab`. Its internal EAS slug remains `happy-improved`: [Expo documents that existing project slugs cannot be changed](https://github.com/expo/fyi/blob/main/eas-project-id.md). This hidden project identity is separate from the installed app's Talos display name. The application version is `2.0.0`; EAS remotely increments the native build number. Signing must preserve the original application identifier prefix and keychain access group. The existing Android signing key is also required to update existing Android installations.

The new runtime remains `talos-1`, distinct from the installed binary's runtime `21`. Reusing the owned EAS project does not make a Talos OTA compatible with the old native binary: [Expo selects compatible updates using runtime versions](https://docs.expo.dev/eas-update/runtime-versions/). The native store update must ship before an installed old binary can display Talos. Do not publish the Talos bundle with runtime `21`.

## Account and session continuity

The update reads the existing `auth_credentials` SecureStore entry with the same default service and access group. It retains both the account token and full account secret; no credential migration, deletion, account creation, or daemon adoption runs on upgrade. Expo documents [SecureStore persistence across app updates](https://docs.expo.dev/versions/latest/sdk/securestore/#data-persistence) and requires matching service options when reading an existing entry.

The default MMKV store and the `server-config` store retain their identifiers and keys. Existing settings, drafts, push registration, and explicit server preferences remain readable. The old default relay and `https://api.talosapp.ai` share the verified account backend, so users who used the default server retain account access through the new default URL. User-selected relay addresses retain priority. Account encryption derivation contexts remain unchanged.

The production binary registers `talos` and the installed `happy` URL scheme. New links use Talos. Account linking and terminal QR scanning also accept valid previously issued links; malformed routes and public keys are rejected. Development and preview do not claim the older scheme.

Uncached session history still requires the full account secret held by an authenticated app. The CLI's imported local session-key index alone does not reconstruct that secret or grant access to uncached history.

## Release verification still required

Before the native store build, confirm the App Store Connect app record, valid distribution certificate/profile, application identifier prefix, and latest accepted version/build. Keep the configured owned EAS project ID and slug. Supply the existing ASC API key at the configured private path through CI credentials. The existing listing is named `Talos — AI Coding Agents` with subtitle `Your coding agents, everywhere`. Apple rejected the exact listing name `Talos` because another account already uses it. The installed app remains named Talos. Keep this existing listing instead of creating a second app record.

Run `APP_ENV=production node scripts/verify-release-config.cjs ios` with the Talos HTTPS endpoint environment. This iOS preflight does not require Android Firebase credentials. Android or combined mobile releases require a Firebase client matching the retained production Android package.

Targeted regressions cover the generated config, production identity override refusal, isolated nonproduction identifiers, version/build settings, existing native secure credentials and MMKV data, and both pairing-link schemes. They do not replace an actual signed update test: install a Talos build over the existing app on a test device without uninstalling, verify it opens the same account and decrypts existing history, and confirm the home-screen identity changes to Talos. Native building, store metadata changes, submission, and publication are separate release actions.
