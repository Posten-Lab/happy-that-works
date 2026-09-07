# Canonical npm publishing

The approved publishing token is stored on the operator MacBook in
`/Users/ahmedposten/.config/talos/npm-publish.npmrc` (mode `0600`). The portable
location is `~/.config/talos/npm-publish.npmrc`. This is the replacement token
that successfully published the first four Talos packages on 6 September 2026;
the operator selected a 90-day lifetime. The token value is not in this repository.

Use this credential for subsequent releases while it remains valid. Do not fall
back to `~/.npmrc`, use an earlier rejected token, or request replacement merely
because a new checkout or agent session is being used.

## Publishing

After preparing versions and completing the [release checks](../../.agents/skills/release/SKILL.md):

```sh
pnpm release all --plan
pnpm release wire --publish
```

Choose the prepared target (`wire`, `server`, `agent`, `cli`, or `all`). The wrapper
automatically sets both uppercase and lowercase npm userconfig variables to the
canonical file for identity checks, registry reads, and every prepublish/upload
subprocess. It rejects missing, nonregular or symlinked credentials, and on Unix
rejects files accessible by other users or owned by another user. Local plans do
not need credentials. Publishing still verifies account `ahmadposten` and registry
`https://registry.npmjs.org`, preserves all prepublish hooks, and refuses existing
immutable versions. Server publication also needs Bun and the production app URLs.

The credential file selects authentication; it does not authorize publishing an
unreviewed version or replace the required tests. Use the wrapper rather than a
bare `npm publish` or `pnpm publish` command that could select a different login.

If the approved token expires or npm rejects its permissions, replace it locally:

```sh
python3 scripts/configure-npm-publishing.py
```

The helper accepts hidden input and updates only the private publishing file,
preserving the general npm login. Never put the token in shell arguments, source
files, issue/PR text, chat, or logs. A successful `whoami` confirms account identity,
not necessarily permission to upload.

## Jenkins and other publishing machines

Current Jenkins jobs deploy web/API images and mobile updates; they do not publish
npm packages. The token has not been installed into Jenkins by this change.

When adding a publishing job, bind the approved credential as a private temporary
npmrc file owned by the job user and set `TALOS_NPM_USERCONFIG` to its absolute path.
This explicit Talos variable is the supported override; inherited generic
`NPM_CONFIG_USERCONFIG` or `npm_config_userconfig` values are not overrides. Do not
embed the token in a Jenkinsfile or copy it into a client installation on Dell.

## Registry availability after upload

npm scans new uploads before making them installable. The initial Talos uploads
were accepted while immediate lookups still returned 404, then verified publicly
after the scan window. The release wrapper currently stops on that immediate
lookup failure. Check registry metadata before continuing; never repeat an upload
just because it is not visible yet. Bounded scan-aware polling remains a separate
automation improvement. See [npm's announcement](https://github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata/).
