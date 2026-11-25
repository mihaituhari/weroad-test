#!/bin/bash
set -euo pipefail
mkdir -p /esdata
chown -R 1000:0 /esdata
# Drop to the elasticsearch user (uid 1000) and start ES the way the official image does.
exec chroot --userspec=1000:0 --skip-chdir / /bin/tini -- /usr/local/bin/docker-entrypoint.sh eswrapper
