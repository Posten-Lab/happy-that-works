#!/usr/bin/env python3
"""Install private, checksum-pinned read-only signature inspection tools.

rcodesign: https://github.com/indygreg/apple-platform-rs/releases/tag/apple-codesign/0.29.0
YAML parser: https://registry.npmjs.org/yaml/2.8.2 (no dependencies or install scripts run).
The recorded checksums were verified against the official release checksums and
npm registry integrity before committing; they are never supplied by a download.
"""
import argparse
import hashlib
import pathlib
import platform
import subprocess
import tarfile
import tempfile

VERSION = '0.29.0'
RELEASE = 'https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign/0.29.0/'
TARGETS = {
    ('Linux', 'x86_64'): ('x86_64-unknown-linux-musl',
        'dbe85cedd8ee4217b64e9a0e4c2aef92ab8bcaaa41f20bde99781ff02e600002',
        'dab9a7465f96aba3c81e793775510f745b91a46b6418e89f7317b5d8fc7bcea2'),
    ('Darwin', 'arm64'): ('aarch64-apple-darwin',
        'd1a532150adaf90048260d76359261aa716abafc45c53c5dc18845029184334a',
        '6c4623db45f1d89af439a2ce42fd65798ef56aaaa3e4ced48879be05f750aacb'),
}
YAML_URL = 'https://registry.npmjs.org/yaml/-/yaml-2.8.2.tgz'
YAML_SHA256 = 'bf99551503fa80b353bab949227e18bd05f28b4f3117b593614f478e37c443b2'
YAML_TREE_SHA256 = '7c717e5c0b0034f6b2c9b14b5df2ac56769876897591d1217b222ba2169aa670'


def target():
    result = TARGETS.get((platform.system(), platform.machine()))
    if not result:
        raise ValueError('No reviewed signature-tool binary for this platform')
    return result


def sha(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def validate_tools(directory):
    directory = pathlib.Path(directory).resolve()
    _, _, binary_hash = target()
    if sha(directory / 'rcodesign') != binary_hash:
        raise ValueError('rcodesign binary does not match the committed SHA256 pin')
    digest = hashlib.sha256()
    for path in sorted((directory / 'yaml').rglob('*'), key=lambda p: p.relative_to(directory / 'yaml').as_posix()):
        if path.is_symlink():
            raise ValueError('Unexpected link in the pinned YAML parser')
        if path.is_file():
            relative = path.relative_to(directory / 'yaml').as_posix()
            digest.update(relative.encode() + b'\0' + hashlib.sha256(path.read_bytes()).digest())
    if digest.hexdigest() != YAML_TREE_SHA256:
        raise ValueError('YAML parser does not match the committed SHA256 tree pin')
    return directory


def download(url, destination, expected):
    subprocess.run(['curl', '--fail', '--silent', '--show-error', '--location', '--proto', '=https',
                    '--proto-redir', '=https', '--connect-timeout', '15', '--max-time', '180',
                    '--max-filesize', '25000000', url, '--output', str(destination)], check=True, timeout=190)
    if sha(destination) != expected:
        raise ValueError('Signature-tool download SHA256 does not match its committed pin')


def install(directory):
    directory = pathlib.Path(directory).resolve()
    if directory.exists():
        return validate_tools(directory)
    directory.parent.mkdir(parents=True, exist_ok=True)
    name, archive_hash, _ = target()
    with tempfile.TemporaryDirectory(prefix='talos-signature-tools-', dir=directory.parent) as temporary:
        staging = pathlib.Path(temporary)
        archive = staging / 'rcodesign.tar.gz'
        download(RELEASE + 'apple-codesign-' + VERSION + '-' + name + '.tar.gz', archive, archive_hash)
        output = staging / 'tools'
        output.mkdir(mode=0o700)
        with tarfile.open(archive) as source:
            member = source.getmember('apple-codesign-' + VERSION + '-' + name + '/rcodesign')
            if not member.isfile() or not 0 < member.size < 100 * 1024**2:
                raise ValueError('Unexpected signature-tool archive member')
            (output / 'rcodesign').write_bytes(source.extractfile(member).read())
            (output / 'rcodesign').chmod(0o500)
        archive = staging / 'yaml.tgz'
        download(YAML_URL, archive, YAML_SHA256)
        with tarfile.open(archive) as source:
            for member in source.getmembers():
                path = pathlib.PurePosixPath(member.name)
                if path.is_absolute() or '..' in path.parts or not member.name.startswith('package/'):
                    raise ValueError('Unexpected YAML archive path')
                if member.isdir():
                    continue
                if not member.isfile() or member.size > 2 * 1024**2:
                    raise ValueError('Unexpected YAML archive member')
                destination = output / 'yaml' / member.name
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(source.extractfile(member).read())
                destination.chmod(0o400)
        validate_tools(output)
        output.rename(directory)
    return directory


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', required=True)
    args = parser.parse_args()
    install(args.output_dir)
    print('Pinned rcodesign 0.29.0 and YAML 2.8.2 inspection tools verified.')
