#!/usr/bin/env bash
set -euo pipefail

# Bound the whole apt operation as well as individual downloads. apt can otherwise
# keep making tiny amounts of progress for many minutes without hitting its timeout.
# A process-group timeout can leave detached apt/dpkg descendants holding locks.
# Hosted Ubuntu's systemd waits for the entire control group to stop before recovery.
install_dependencies() {
  sudo systemd-run --quiet --wait --collect --pipe --working-directory="$PWD" \
    --property=RuntimeMaxSec=240s --property=TimeoutStopSec=10s \
    --property=KillMode=control-group \
    /usr/bin/env "PATH=$PATH" pnpm --filter @dovo/runtime exec playwright install-deps chromium
}
if ! install_dependencies; then
  echo '::warning::Chromium dependency setup failed or stalled; retrying with the primary Ubuntu mirror.'
  sudo timeout --kill-after=10s 120 dpkg --configure -a
  sudo node scripts/ci/linux-apt.mjs fallback
  install_dependencies
fi
# Keep browser binaries in the runner user's Playwright cache, never root's cache.
timeout --kill-after=10s 240 pnpm --filter @dovo/runtime exec playwright install chromium
