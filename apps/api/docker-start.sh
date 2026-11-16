#!/bin/sh
# Container main process: run the Dovo runtime in the foreground.
set -eu
# Save the listen settings so `dovo-server pair` and `status` find this runtime. Setup keeps the
# database, owner credential and device pairings. DOVO_PUBLIC_ADDRESS is the address that phones
# and other computers use, because the container cannot see the host's LAN or VPN addresses.
# An empty or unset DOVO_PUBLIC_ADDRESS clears the saved address, so removing it from .env works.
dovo-server setup --host "$DOVO_HOST" --port "$PORT" --public-address "${DOVO_PUBLIC_ADDRESS:-}" >/dev/null
exec /opt/dovo-server/libexec/node /opt/dovo-server/libexec/server/dist/index.js
