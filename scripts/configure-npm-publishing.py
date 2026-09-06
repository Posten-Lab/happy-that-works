#!/usr/bin/env python3
"""Save a registry-scoped publishing token without changing the existing npm login."""

import getpass
import os
from pathlib import Path
import re
import stat
import tempfile


def main():
    directory = Path.home() / ".config" / "talos"
    destination = directory / "npm-publish.npmrc"
    if directory.is_symlink() or destination.is_symlink():
        raise SystemExit("Refusing a symlink at the publishing configuration path.")
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.stat().st_uid != os.getuid():
        raise SystemExit("Publishing configuration directory must belong to this user.")
    os.chmod(directory, 0o700)
    if destination.exists() and not stat.S_ISREG(destination.stat().st_mode):
        raise SystemExit("Publishing configuration must be a regular file.")

    token = getpass.getpass("Paste npm publishing token (input hidden): ").strip()
    if not re.fullmatch(r"npm_[A-Za-z0-9]+", token):
        raise SystemExit("Expected an npm token; no configuration was written.")

    descriptor, temporary = tempfile.mkstemp(prefix=".npm-publish-", dir=directory)
    try:
        with os.fdopen(descriptor, "w") as output:
            os.fchmod(output.fileno(), 0o600)
            output.write("//registry.npmjs.org/:_authToken=" + token + "\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, destination)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

    print("Private publishing configuration saved. Existing npm login preserved.")


if __name__ == "__main__":
    main()
