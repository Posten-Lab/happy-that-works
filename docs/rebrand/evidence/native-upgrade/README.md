# Native iOS upgrade evidence

The original-source 1.7.0 app was installed on the dedicated iOS 26.1 simulator, used to create an isolated account, and paired with a real Talos CLI through the retained `happy://terminal` scheme. It decrypted a synthetic session and saved the explicit Light preference. The actual Talos 2.0.0 native app was then installed over it **without uninstalling**.

Talos opened the existing account, decrypted the original session, and retained Light while the simulator remained in Dark mode. A message typed into Talos's native composer was stored in the same session: the relay's message count increased from 2 to 3. After terminating and relaunching Talos, both messages were still decrypted and visible. No model run was needed; an authenticated synthetic session socket supplied presence while the native app sent its encrypted message to the real local relay.

The simulator reallocated the data container during installation and retained its contents. The `server-config` MMKV files remained byte-identical. The default MMKV files persisted and changed as Talos loaded and continued the session. The native SecureStore and MMKV source files are byte-identical between the two source snapshots.

## Exact inputs and limits

- Original source: `4780b7b244c4311992a41a407e21be512042a459`, the source recorded by distributed iOS build 14.
- Talos source: `f4e4c100` (full commit and binary hashes in [verification.json](verification.json)). The generated associated-domains entitlement was removed to match the final configuration correction in `7d0d34f2`; this was the only app source change after that snapshot.
- Both are actual Release builds for `iphonesimulator`, with production bundle identifier `com.ahposten.happyimproved`, isolated localhost relay URLs, and OTA disabled. Existing installed dependencies were reused from temporary source snapshots. The original working tree was not modified.
- These local builds have ad hoc signatures with empty entitlements and local build number 1. They are not the downloaded App Store binary and do not prove App Store signing enforcement. The legacy fixture reports `file:fingerprint` in its generated Expo runtime configuration; Talos reports `talos-1`.

The actual distributed 1.7.0 build 14 IPA was independently downloaded and inspected. Its signature uses application identifier `H2XR8XWZXW.com.ahposten.happyimproved`, team/prefix `H2XR8XWZXW`, no explicit keychain access group, production push, and no associated-domains entitlement. [baseline-signing.json](baseline-signing.json) records the public identity fields and IPA hash, without the IPA, provisioning profile, credentials, or download URL.

The final EAS distribution artifact must preserve that signing identity and default keychain group before submission. A physical-device TestFlight upgrade and Android signing upgrade remain separate checks; this evidence does not claim either.

## Evidence

[verification.json](verification.json) records checks, source and binary hashes, storage comparisons, and fixture overrides. [screenshots.json](screenshots.json) describes each screenshot and records its SHA-256. All visible account/session content is synthetic. The two Maestro flows capture history after installation and persistence after native relaunch; they assume the isolated session fixture already exists.
