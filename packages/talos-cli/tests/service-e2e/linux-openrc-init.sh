#!/bin/sh
set -eu
mkdir -p /run/openrc
touch /run/openrc/softlevel
openrc default
trap 'openrc shutdown; exit 0' TERM INT
while :; do
  sleep 30 &
  wait "$!" || true
done
