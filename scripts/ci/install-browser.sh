#!/usr/bin/env bash
set -euo pipefail

# Bound the whole apt operation as well as individual downloads. apt can otherwise
# keep making tiny amounts of progress for many minutes without hitting its timeout.
if timeout --kill-after=10s 240 pnpm --filter @dovo/runtime exec playwright install --with-deps chromium; then
  exit 0
fi
echo '::warning::Chromium dependency setup failed or stalled; retrying with the primary Ubuntu mirror.'
timeout --kill-after=10s 120 sudo dpkg --configure -a
sudo node scripts/ci/linux-apt.mjs fallback
timeout --kill-after=10s 240 pnpm --filter @dovo/runtime exec playwright install --with-deps chromium
