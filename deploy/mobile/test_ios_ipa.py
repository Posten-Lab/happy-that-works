import copy
import datetime
import importlib.util
import pathlib
import plistlib
import subprocess
import sys
import tempfile
import unittest
import warnings
import zipfile

SPEC = importlib.util.spec_from_file_location('verify_ios_ipa', pathlib.Path(__file__).with_name('verify-ios-ipa.py'))
checker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checker)
NOW = datetime.datetime(2026, 9, 6, tzinfo=datetime.timezone.utc)


class IpaGateTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='talos-ipa-fixture-')
        self.path = pathlib.Path(self.directory.name) / 'fixture.ipa'
        self.info = {
            'CFBundleIdentifier': checker.BUNDLE_ID, 'CFBundleDisplayName': 'Talos',
            'CFBundleShortVersionString': '2.0.0', 'CFBundleVersion': '15',
            'CFBundleIcons': {'CFBundlePrimaryIcon': {'CFBundleIconFiles': ['AppIcon60x60']}},
        }
        self.expo = {'EXUpdatesRuntimeVersion': 'talos-1', 'EXUpdatesEnabled': True}
        self.profile = {
            'TeamIdentifier': [checker.TEAM], 'ApplicationIdentifierPrefix': [checker.TEAM],
            'ExpirationDate': datetime.datetime(2027, 1, 1),
            'Entitlements': {
                'application-identifier': checker.APP_ID,
                'com.apple.developer.team-identifier': checker.TEAM,
                'keychain-access-groups': [checker.TEAM + '.*', 'com.apple.token'],
                'get-task-allow': False, 'aps-environment': 'production', 'beta-reports-active': True,
            },
        }

    def tearDown(self):
        self.directory.cleanup()

    def write(self, extra=None, omit=None, profile_bytes=b'profile-fixture'):
        files = {'Info.plist': plistlib.dumps(self.info), 'Expo.plist': plistlib.dumps(self.expo),
                 'embedded.mobileprovision': profile_bytes, 'AppIcon60x60@2x.png': b'\x89PNG\r\n\x1a\nfixture'}
        with zipfile.ZipFile(self.path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            for name, content in files.items():
                if name != omit:
                    archive.writestr('Payload/Talos.app/' + name, content)
            if extra:
                with warnings.catch_warnings():
                    warnings.simplefilter('ignore', UserWarning)
                    archive.writestr(*extra)

    def inspect(self, expected_version='2.0.0', expected_runtime='talos-1'):
        return checker.inspect_ipa(self.path, expected_version=expected_version, expected_runtime=expected_runtime,
                                   profile_decoder=lambda _: self.profile, now=NOW)

    def test_future_release_uses_reviewed_version_and_runtime(self):
        self.info['CFBundleShortVersionString'] = '2.1.0'
        self.expo['EXUpdatesRuntimeVersion'] = 'talos-2'
        self.write()
        report = self.inspect(expected_version='2.1.0', expected_runtime='talos-2')
        self.assertTrue(report['passed'])
        self.assertEqual(report['version'], '2.1.0')
        self.assertEqual(report['runtimeVersion'], 'talos-2')
        with self.assertRaisesRegex(ValueError, 'version differs'):
            self.inspect(expected_version='2.0.0', expected_runtime='talos-2')
        with self.assertRaisesRegex(ValueError, 'Runtime differs'):
            self.inspect(expected_version='2.1.0', expected_runtime='talos-1')

    def test_release_expectations_are_required_and_validated(self):
        self.write()
        for version in ['', '2.0', '02.0.0', '2.0.0-beta', '2.0.0\n', None, 2]:
            with self.subTest(version=version):
                with self.assertRaisesRegex(ValueError, 'Expected version'):
                    self.inspect(expected_version=version)
        for runtime in ['', ' talos-2', 'talos-2\n', 'file:fingerprint', 'x' * 129, None, {'policy': 'fingerprint'}]:
            with self.subTest(runtime=runtime):
                with self.assertRaisesRegex(ValueError, 'Expected runtime'):
                    self.inspect(expected_runtime=runtime)
        for flags in [[], ['--expected-version', '2.0.0'], ['--expected-runtime', 'talos-1']]:
            with self.subTest(flags=flags):
                result = subprocess.run([sys.executable, str(pathlib.Path(checker.__file__)), str(self.path),
                                         '--output', str(pathlib.Path(self.directory.name) / 'report.json'), *flags],
                                        capture_output=True, text=True)
                self.assertEqual(result.returncode, 2)
                self.assertIn('required', result.stderr)

    def test_valid_metadata_retains_identity_and_sanitizes_report(self):
        self.profile['private-test-field'] = 'must-not-appear'
        self.write()
        report = self.inspect()
        self.assertTrue(report['passed'])
        self.assertEqual(report['profile']['applicationIdentifier'], checker.APP_ID)
        self.assertFalse(report['profile']['certificateChainTrustVerified'])
        self.assertEqual(len(report['ipaSha256']), 64)
        self.assertNotIn('must-not-appear', str(report))

    def test_refuses_different_app_brand_runtime_or_old_build(self):
        changes = [('info', 'CFBundleIdentifier', 'com.ahposten.talos'),
                   ('info', 'CFBundleDisplayName', 'Happy-Improved'),
                   ('info', 'CFBundleShortVersionString', '1.7.0'),
                   ('info', 'CFBundleVersion', '14'), ('info', 'CFBundleVersion', '1.5'),
                   ('expo', 'EXUpdatesRuntimeVersion', '21'), ('expo', 'EXUpdatesEnabled', False)]
        for target, field, value in changes:
            with self.subTest(field=field, value=value):
                original = getattr(self, target)[field]
                getattr(self, target)[field] = value
                self.write()
                with self.assertRaises(ValueError): self.inspect()
                getattr(self, target)[field] = original

    def test_refuses_incompatible_development_expired_or_expanded_profile(self):
        changes = [('TeamIdentifier', ['DIFFERENT']), ('ApplicationIdentifierPrefix', ['DIFFERENT']),
                   ('ExpirationDate', datetime.datetime(2026, 1, 1)),
                   ('ProvisionedDevices', ['synthetic-test-device']), ('ProvisionsAllDevices', True)]
        for field, value in changes:
            with self.subTest(field=field):
                original = copy.deepcopy(self.profile)
                self.profile[field] = value
                self.write()
                with self.assertRaises(ValueError): self.inspect()
                self.profile = original
        changes = [('application-identifier', 'OTHER.' + checker.BUNDLE_ID),
                   ('com.apple.developer.team-identifier', 'OTHER'),
                   ('keychain-access-groups', ['OTHER.*']), ('keychain-access-groups', [checker.TEAM + '.*', 'OTHER.*']),
                   ('get-task-allow', True), ('aps-environment', 'development'), ('beta-reports-active', False),
                   ('com.apple.developer.associated-domains', ['applinks:talosapp.ai'])]
        for field, value in changes:
            with self.subTest(entitlement=field):
                original = copy.deepcopy(self.profile)
                self.profile['Entitlements'][field] = value
                self.write()
                with self.assertRaises(ValueError): self.inspect()
                self.profile = original

    def test_refuses_missing_metadata_icons_and_unsafe_or_ambiguous_archives(self):
        for omitted in ['Info.plist', 'Expo.plist', 'embedded.mobileprovision', 'AppIcon60x60@2x.png']:
            with self.subTest(omitted=omitted):
                self.write(omit=omitted)
                with self.assertRaises(ValueError): self.inspect()
        for extra in [('Payload/Talos.app/Info.plist', b'duplicate'), ('../escape', b'bad'),
                      ('Payload/Other.app/Info.plist', plistlib.dumps(self.info)),
                      ('Payload/Talos.app/Expo.plist', b'x' * (checker.MAX_METADATA_BYTES + 1))]:
            with self.subTest(path=extra[0]):
                self.write(extra=extra)
                with self.assertRaises(ValueError): self.inspect()
        self.write(omit='Expo.plist', extra=('Payload/Talos.app/Expo.plist', b'x' * (checker.MAX_METADATA_BYTES + 1)))
        with self.assertRaisesRegex(ValueError, 'size limit'): self.inspect()

    def test_openssl_cms_integrity_decoder_and_tampering_rejection(self):
        directory = pathlib.Path(self.directory.name)
        key, cert, profile, signed = [directory / name for name in ['key.pem', 'cert.pem', 'profile.plist', 'profile.der']]
        profile.write_bytes(plistlib.dumps(self.profile))
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(key),
                        '-out', str(cert), '-subj', '/CN=Talos synthetic profile fixture', '-days', '1'],
                       capture_output=True, check=True, timeout=20)
        subprocess.run(['openssl', 'cms', '-sign', '-binary', '-nodetach', '-in', str(profile),
                        '-signer', str(cert), '-inkey', str(key), '-outform', 'DER', '-out', str(signed)],
                       capture_output=True, check=True, timeout=15)
        content = signed.read_bytes()
        self.write(profile_bytes=content)
        self.assertTrue(checker.inspect_ipa(self.path, expected_version='2.0.0', expected_runtime='talos-1', now=NOW)['passed'])
        self.assertIn(checker.TEAM.encode(), content)
        tampered = content.replace(checker.TEAM.encode(), b'XXXXXXXXXX', 1)
        with self.assertRaisesRegex(ValueError, 'CMS integrity'):
            checker.decode_profile(tampered)


if __name__ == '__main__':
    unittest.main()
