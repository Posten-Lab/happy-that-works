#!/usr/bin/env python3
"""Gate iOS submission using bounded IPA metadata reads and an established CMS decoder.

This validates the embedded provisioning profile, not the Mach-O signature or its
effective entitlements. The final Mac codesign comparison is a separate check.
OpenSSL verifies CMS integrity with -noverify; Apple certificate-chain trust is
not asserted here. The caller must download the exact authenticated EAS build.
"""
import argparse
import datetime
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import zipfile
import plistlib

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


def inspect_ipa(ipa, profile_decoder=decode_profile, now=None):
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
        require(info.get('CFBundleShortVersionString') == '2.0.0', 'Installed version must be 2.0.0')
        number = str(info.get('CFBundleVersion', ''))
        require(bool(re.fullmatch(r'[1-9][0-9]{0,8}', number)) and int(number) > BASELINE_BUILD,
                'Native build number must advance beyond distributed build 14')
        require(expo.get('EXUpdatesRuntimeVersion') == 'talos-1', 'Runtime must be talos-1')
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
        'profile': {'applicationIdentifier': APP_ID, 'team': TEAM, 'prefix': TEAM,
                    'keychainAccessGroups': groups, 'expires': expiration.isoformat(),
                    'cmsIntegrityVerified': True, 'certificateChainTrustVerified': False},
        'icons': icon_hashes,
        'limits': ['Executable codesign/effective entitlements require the separate Mac comparison.',
                   'Icon presence is verified; the extracted release icon still requires visual brand inspection.',
                   'This artifact check does not perform a physical-device upgrade.'],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('ipa')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    try:
        report = inspect_ipa(args.ipa)
    except (ValueError, KeyError, OSError, zipfile.BadZipFile, plistlib.InvalidFileException, subprocess.SubprocessError) as error:
        # Do not expose raw OpenSSL output, archive content, URLs, or credentials.
        message = str(error) if isinstance(error, ValueError) else type(error).__name__
        print('IPA continuity verification failed: ' + message, file=sys.stderr)
        return 1
    pathlib.Path(args.output).write_text(json.dumps(report, indent=2) + '\n')
    print('IPA continuity verification passed: Talos 2.0.0, retained app/profile identity, runtime talos-1.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
