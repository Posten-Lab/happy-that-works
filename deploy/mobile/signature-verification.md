# Executable signature gate

The IPA gate uses a private installation of `rcodesign` 0.29.0 and the dependency-free `yaml` 2.8.2 parser. Committed SHA-256 values pin both downloaded archives, the native executable, and the extracted parser tree. Downloads do not choose their own expected checksums. No global installation or signing/rewrite command runs.

`apple_signature_tools.py --output-dir DIR` installs or validates that directory. Supply it to `verify-ios-ipa.py --signature-tools DIR`, together with the expected version/runtime resolved from the reviewed production Expo config. The IPA checker extracts only the bounded main executable into a private temporary directory with read-only file permissions. It inspects every slice returned by the established [signature-info command](https://gregoryszorc.com/docs/apple-codesign/main/apple_codesign_debugging.html).

Every slice must retain the code-directory identifier/team, matching XML and DER entitlements, application identifier, team, production push, disabled debugging, and baseline-supported capabilities. Alternate code directories must agree. Build 14 has no explicit keychain group, so its default is the application identifier; the gate permits an absent group or the same singleton group. CMS signatures must verify, and the report must contain the expected Apple distribution certificate. `rcodesign verify` must report no problems.

The tool's upstream verification command explicitly warns that verification is incomplete and has known bugs. Passing this gate does not claim complete Apple `codesign`, certificate revocation, or App Store acceptance validation. Profile CMS integrity is checked separately with OpenSSL, without claiming profile certificate-chain trust. macOS `codesign` inspection remains additional release evidence.

## Actual baseline cross-check

The actual distributed iOS build 14 executable, SHA-256 `3e89616085955fee474b6432a1aab912d947d9fe2a886683bbbb8d6784984177`, passed this executable gate on both macOS arm64 and the actual Linux x86_64 EAS agent image. Both XML and decoded DER dictionaries exactly matched Apple's `codesign` output. A separate copy with one byte changed in signed code was rejected on both platforms. The downloaded IPA and original executable were not modified.

`fixtures/build14-executable-signature.json` contains selected nonsecret fields from that actual report, excluding certificate subjects and other unused data. Tests exercise those real fields independently from the intentional rejection of build 14's old display name/version. Additional cases reject a bad second slice, changed keychain defaults, XML/DER disagreement, missing or unverified signatures, wrong file hashes, and changed tool archives/binaries. The Apple distribution app's identity remains `H2XR8XWZXW.com.ahposten.happyimproved` to preserve installed account access.

Official pinned release: [Apple Codesign 0.29.0](https://github.com/indygreg/apple-platform-rs/releases/tag/apple-codesign/0.29.0). The small YAML parser is independently pinned to the [official npm 2.8.2 package](https://registry.npmjs.org/yaml/2.8.2) and loaded only from the private tool directory.
