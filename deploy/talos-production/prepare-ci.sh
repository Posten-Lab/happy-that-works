#!/bin/sh
set -eu
# Run in the Node build container. The pod's existing service account supplies
# kubectl authentication; no credentials are copied into the workspace.
mkdir -p "$WORKSPACE/.ci-bin"
export COREPACK_HOME=/tmp/corepack
corepack enable --install-directory "$WORKSPACE/.ci-bin" pnpm
corepack prepare pnpm@10.11.0 --activate
if [ "${1:-}" = kubectl ]; then
    case "$(uname -m)" in x86_64) architecture=amd64;; aarch64) architecture=arm64;; *) exit 1;; esac
    artifact="https://dl.k8s.io/release/v1.34.1/bin/linux/$architecture/kubectl"
    curl --fail --location --retry 2 --connect-timeout 10 --max-time 90 "$artifact" -o "$WORKSPACE/.ci-bin/kubectl"
    expected=$(curl --fail --location --retry 2 --connect-timeout 10 --max-time 30 "$artifact.sha256")
    printf '%s  %s\n' "$expected" "$WORKSPACE/.ci-bin/kubectl" | sha256sum --check --status
    chmod 755 "$WORKSPACE/.ci-bin/kubectl"
fi
