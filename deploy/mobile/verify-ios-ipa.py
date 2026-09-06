#!/usr/bin/env python3
"""Gate iOS submission using bounded IPA metadata reads and an established CMS decoder.

This validates the profile and every executable slice using pinned rcodesign.
rcodesign documents incomplete verification; no complete Apple validation claim
is made. OpenSSL verifies profile CMS integrity with -noverify, without checking
profile certificate-chain trust. The caller must download the exact EAS build.
"""
import argparse
import datetime
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import tempfile
import zipfile
import plistlib
from apple_signature_tools import validate_tools, VERSION as RCODESIGN_VERSION

BUNDLE_ID = 'com.ahposten.happyimproved'
TEAM = 'H2XR8XWZXW'
APP_ID = TEAM + '.' + BUNDLE_ID
BASELINE_BUILD = 14
MAX_IPA_BYTES = 512 * 1024 * 1024
MAX_METADATA_BYTES = 2 * 1024 * 1024
PROFILE_CAPABILITIES = {
    'application-identifier', 'com.apple.developer.team-identifier',
    'keychain-access-groups', 'aps-environment', 'get-task-allow',
    'beta-reports-active', 'com.apple.developer.usernotifications.time-sensitive',
    'com.apple.developer.usernotifications.communication',
}
EXECUTABLE_CAPABILITIES = {
    'application-identifier', 'com.apple.developer.team-identifier',
    'keychain-access-groups', 'aps-environment', 'get-task-allow', 'beta-reports-active',
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def decode_profile(content):
    result = subprocess.run(
        ['openssl', 'cms', '-verify', '-inform', 'DER', '-noverify'],
        input=content, capture_output=True, timeout=15,
    )
    require(result.returncode == 0, 'Provisioning profile CMS integrity check failed')
    require(len(result.stdout) <= MAX_METADATA_BYTES, 'Decoded provisioning profile exceeds size limit')
    return plistlib.loads(result.stdout)


def validate_signature_report(entities, executable_sha256):
    require(isinstance(entities, list) and 1 <= len(entities) <= 16, 'Executable signature report has no valid slices')
    slices = []
    for index, entity in enumerate(entities):
        require(entity.get('file_sha256') == executable_sha256, 'Signature report does not match the extracted executable')
        require(entity.get('sub_path') == f'macho-index:{index}' or
                (len(entities) == 1 and entity.get('sub_path') is None), 'Unexpected or missing executable slice')
        signature = entity.get('entity', {}).get('mach_o', {}).get('signature')
        require(isinstance(signature, dict), 'Executable slice is unsigned or is not Mach-O')
        directory = signature.get('code_directory', {})
        require(directory.get('identifier') == BUNDLE_ID, 'Executable code-directory identifier differs from the installed app')
        require(directory.get('team_name') == TEAM, 'Executable code-directory team differs from the installed app')
        for alternative in signature.get('alternative_code_directories', []):
            require(isinstance(alternative, list) and len(alternative) == 2 and
                    alternative[1].get('identifier') == BUNDLE_ID and alternative[1].get('team_name') == TEAM,
                    'Executable alternate code-directory identity differs from the installed app')
        require(signature.get('entitlements_plist') and signature.get('entitlements_der_plist'),
                'Executable slice must provide both XML and DER entitlements')
        xml = plistlib.loads('\n'.join(signature['entitlements_plist']).encode())
        der = plistlib.loads('\n'.join(signature['entitlements_der_plist']).encode())
        require(isinstance(xml, dict) and xml == der, 'Executable XML and DER entitlements disagree')
        require(xml.get('application-identifier') == APP_ID, 'Effective executable application identifier changed')
        require(xml.get('com.apple.developer.team-identifier') == TEAM, 'Effective executable team identifier changed')
        # Build14 has no explicit group: its default is its application identifier.
        # A singleton explicit group is equivalent; any other group can change the
        # default or expose additional keychain items and must fail review.
        require(xml.get('keychain-access-groups') in (None, [APP_ID]), 'Effective executable default keychain group changed')
        require(xml.get('get-task-allow') is False, 'Effective executable permits development debugging')
        require(xml.get('aps-environment') == 'production', 'Effective executable push environment changed')
        require(xml.get('beta-reports-active') is True, 'Effective executable is missing store beta reporting')
        require(set(xml) <= EXECUTABLE_CAPABILITIES, 'Effective executable introduces an unsupported capability')
        cms = signature.get('cms', {})
        signers = cms.get('signers', [])
        require(isinstance(signers, list) and bool(signers) and
                all(signer.get('signature_verifies') is True for signer in signers), 'Executable CMS signature verification failed')
        certificates = cms.get('certificates', [])
        require(any(certificate.get('apple_team_id') == TEAM and certificate.get('chains_to_apple_root_ca') is True and
                    'Apple Developer Certificate (Submission)' in certificate.get('apple_code_signing_extensions', [])
                    for certificate in certificates), 'Executable lacks the expected Apple distribution certificate')
        slices.append({'index': index, 'codeDirectoryIdentifier': directory['identifier'],
                       'codeDirectoryTeam': directory['team_name'], 'xmlAndDerEntitlementsMatch': True,
                       'entitlements': xml, 'effectiveDefaultKeychainGroup': APP_ID, 'cmsSignaturesVerified': True})
    return slices


def inspect_executable(executable, tools_directory):
    require(tools_directory is not None, 'Pinned signature inspection tools are required')
    tools_directory = validate_tools(tools_directory)
    executable = pathlib.Path(executable)
    inspector = str(tools_directory / 'rcodesign')
    result = subprocess.run([inspector, 'print-signature-info', str(executable)], capture_output=True, timeout=60)
    require(result.returncode == 0 and 0 < len(result.stdout) <= 16 * 1024**2, 'Executable signature inspection failed')
    parsed = subprocess.run(['node', str(pathlib.Path(__file__).with_name('signature-yaml.cjs')), str(tools_directory)],
                            input=result.stdout, capture_output=True, timeout=20)
    require(parsed.returncode == 0, 'Executable signature YAML decoding failed')
    slices = validate_signature_report(json.loads(parsed.stdout), hashlib.sha256(executable.read_bytes()).hexdigest())
    verification = subprocess.run([inspector, 'verify', str(executable)], capture_output=True, timeout=60)
    require(verification.returncode == 0, 'rcodesign reported executable signature problems')
    return {'tool': 'rcodesign', 'version': RCODESIGN_VERSION, 'slices': slices,
            'verificationReportedNoProblems': True,
            'limit': 'rcodesign 0.29.0 documents incomplete/known-buggy verification; this is not complete Apple codesign validation.'}


def inspect_ipa(ipa, *, expected_version, expected_runtime, signature_tools=None,
                profile_decoder=decode_profile, signature_inspector=inspect_executable, now=None):
    require(isinstance(expected_version, str) and
            bool(re.fullmatch(r'(?:0|[1-9][0-9]{0,8})(?:\.(?:0|[1-9][0-9]{0,8})){2}', expected_version)),
            'Expected version must be a reviewed three-part numeric release version')
    require(isinstance(expected_runtime, str) and
            bool(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', expected_runtime)),
            'Expected runtime must be a reviewed explicit runtime string')
    now = now or datetime.datetime.now(datetime.timezone.utc)
    ipa = pathlib.Path(ipa)
    require(0 < ipa.stat().st_size <= MAX_IPA_BYTES, 'IPA exceeds size limit or is empty')
    with zipfile.ZipFile(ipa) as archive:
        entries = archive.infolist()
        require(len(entries) <= 50000, 'IPA contains too many entries')
        names = [entry.filename for entry in entries]
        require(len(names) == len(set(names)), 'IPA contains duplicate paths')
        require(sum(entry.file_size for entry in entries) <= 2 * 1024**3, 'IPA expanded size exceeds limit')
        for entry in entries:
            path = pathlib.PurePosixPath(entry.filename)
            require(not path.is_absolute() and '..' not in path.parts and '\\' not in entry.filename,
                    'IPA contains an unsafe path')
            require(((entry.external_attr >> 16) & 0o170000) != 0o120000, 'IPA contains an unexpected symlink')
        roots = [name[:-len('Info.plist')] for name in names
                 if re.fullmatch(r'Payload/[^/]+\.app/Info\.plist', name)]
        require(len(roots) == 1, 'IPA must contain exactly one main application')
        root = roots[0]

        def read(relative):
            name = root + relative
            require(name in names, 'IPA is missing required application metadata')
            entry = archive.getinfo(name)
            require(0 < entry.file_size <= MAX_METADATA_BYTES, 'IPA metadata exceeds size limit or is empty')
            return archive.read(entry)

        info = plistlib.loads(read('Info.plist'))
        expo = plistlib.loads(read('Expo.plist'))
        profile = profile_decoder(read('embedded.mobileprovision'))
        ent = profile.get('Entitlements', {})
        require(info.get('CFBundleIdentifier') == BUNDLE_ID, 'Bundle identifier would create a different installed app')
        require(info.get('CFBundleDisplayName') == 'Talos', 'Installed display name must be Talos')
        require(info.get('CFBundleShortVersionString') == expected_version, 'Installed version differs from the reviewed checkout')
        number = str(info.get('CFBundleVersion', ''))
        require(bool(re.fullmatch(r'[1-9][0-9]{0,8}', number)) and int(number) > BASELINE_BUILD,
                'Native build number must advance beyond distributed build 14')
        require(expo.get('EXUpdatesRuntimeVersion') == expected_runtime, 'Runtime differs from the reviewed checkout')
        require(expo.get('EXUpdatesEnabled') is True, 'Production OTA configuration must remain enabled')
        require(ent.get('application-identifier') == APP_ID, 'Profile application identifier differs from the installed app')
        require(ent.get('com.apple.developer.team-identifier') == TEAM, 'Profile entitlement team differs from the installed app')
        require(profile.get('TeamIdentifier') == [TEAM], 'Profile signing team differs from the installed app')
        require(profile.get('ApplicationIdentifierPrefix') == [TEAM], 'Profile application prefix would lose keychain access')
        groups = ent.get('keychain-access-groups', [])
        require(isinstance(groups, list) and (TEAM + '.*' in groups or APP_ID in groups),
                'Profile must permit the existing default keychain group')
        require(set(groups) <= {TEAM + '.*', APP_ID, 'com.apple.token'}, 'Profile has an unexpected keychain group')
        require(ent.get('get-task-allow') is False, 'Development signing is not allowed')
        require(ent.get('aps-environment') == 'production', 'Profile push environment must be production')
        require(not profile.get('ProvisionedDevices') and not profile.get('ProvisionsAllDevices'),
                'Profile must be an App Store profile, not device or enterprise distribution')
        require(ent.get('beta-reports-active') is True, 'Profile must support App Store beta reporting')
        require(set(ent) <= PROFILE_CAPABILITIES, 'Profile introduces a capability absent from distributed build 14')
        expiration = profile.get('ExpirationDate')
        require(isinstance(expiration, datetime.datetime), 'Profile expiration is missing')
        expiration = expiration.replace(tzinfo=datetime.timezone.utc) if expiration.tzinfo is None else expiration
        require(expiration > now, 'Provisioning profile has expired')
        executable_name = info.get('CFBundleExecutable')
        require(isinstance(executable_name, str) and bool(re.fullmatch(r'[A-Za-z0-9_.-]+', executable_name)) and
                executable_name not in ('.', '..'), 'Application executable name is invalid')
        executable_entry = archive.getinfo(root + executable_name)
        require(0 < executable_entry.file_size <= 256 * 1024**2, 'Application executable exceeds size limit or is empty')
        with tempfile.TemporaryDirectory(prefix='talos-ipa-executable-') as temporary:
            executable = pathlib.Path(temporary) / executable_name
            executable.write_bytes(archive.read(executable_entry))
            executable.chmod(0o400)
            executable_signature = signature_inspector(executable, signature_tools)
        icon_files = info.get('CFBundleIcons', {}).get('CFBundlePrimaryIcon', {}).get('CFBundleIconFiles', [])
        require(isinstance(icon_files, list) and bool(icon_files), 'Application icon declaration is missing')
        icons = [name for name in names if name.startswith(root) and '/' not in name[len(root):]
                 and name.endswith('.png') and name[len(root):].startswith('AppIcon')]
        require(bool(icons), 'Application icon files are missing')
        icon_hashes = []
        for name in icons:
            content = read(name[len(root):])
            require(content.startswith(b'\x89PNG\r\n\x1a\n'), 'Application icon is not a PNG')
            icon_hashes.append({'name': name[len(root):], 'sha256': hashlib.sha256(content).hexdigest()})
    digest = hashlib.sha256()
    with ipa.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(block)
    return {
        'passed': True, 'ipaSha256': digest.hexdigest(), 'ipaBytes': ipa.stat().st_size,
        'bundleIdentifier': BUNDLE_ID, 'displayName': info['CFBundleDisplayName'],
        'version': info['CFBundleShortVersionString'], 'buildNumber': number,
        'runtimeVersion': expo['EXUpdatesRuntimeVersion'],
        'executableSignature': executable_signature,
        'profile': {'applicationIdentifier': APP_ID, 'team': TEAM, 'prefix': TEAM,
                    'keychainAccessGroups': groups, 'expires': expiration.isoformat(),
                    'cmsIntegrityVerified': True, 'certificateChainTrustVerified': False},
        'icons': icon_hashes,
        'limits': ['rcodesign checks effective XML/DER entitlements and reports signature problems; upstream documents incomplete verification. A Mac codesign comparison remains additional evidence.',
                   'Icon presence is verified; the extracted release icon still requires visual brand inspection.',
                   'This artifact check does not perform a physical-device upgrade.'],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('ipa')
    parser.add_argument('--expected-version', required=True, help='Version from the reviewed checkout production Expo config')
    parser.add_argument('--expected-runtime', required=True, help='Explicit runtime string from the reviewed checkout production Expo config')
    parser.add_argument('--signature-tools', required=True, help='Directory installed by apple_signature_tools.py')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    try:
        report = inspect_ipa(args.ipa, expected_version=args.expected_version, expected_runtime=args.expected_runtime,
                             signature_tools=args.signature_tools)
    except (ValueError, KeyError, OSError, zipfile.BadZipFile, plistlib.InvalidFileException, subprocess.SubprocessError) as error:
        # Do not expose raw OpenSSL output, archive content, URLs, or credentials.
        message = str(error) if isinstance(error, ValueError) else type(error).__name__
        print('IPA continuity verification failed: ' + message, file=sys.stderr)
        return 1
    pathlib.Path(args.output).write_text(json.dumps(report, indent=2) + '\n')
    print(f"IPA continuity verification passed: Talos {report['version']}, retained app/profile identity, runtime {report['runtimeVersion']}.")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
