#!/bin/sh
set -eu
# Submission credentials never participate in EAS Build/Update fingerprinting.
# Restore the original bytes even when submission fails or is interrupted.
umask 077
SUBMIT_CONFIG_BACKUP=$(mktemp /tmp/talos-submit-config.XXXXXX)
cp eas.json "$SUBMIT_CONFIG_BACKUP"
cleanup() { cp "$SUBMIT_CONFIG_BACKUP" eas.json; rm -f "$SUBMIT_CONFIG_BACKUP"; }
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
node "$(dirname "$0")/prepare-submit.cjs"
eas submit -p ios --profile production --id "${1:?Exact verified build ID required}" --non-interactive --wait
