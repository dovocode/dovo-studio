#!/usr/bin/env bash
set -euo pipefail

# Bound the whole apt operation as well as individual downloads. apt can otherwise
# keep making tiny amounts of progress for many minutes without hitting its timeout.
# Run the dependency timeout as root too: an unprivileged timeout cannot stop
# Playwright's sudo-owned apt descendants, which otherwise retain dpkg's lock.
install_dependencies() {
  sudo timeout --kill-after=10s 240 env "PATH=$PATH" pnpm --filter @dovo/runtime exec playwright install-deps chromium
}
if ! install_dependencies; then
  echo '::warning::Chromium dependency setup failed or stalled; retrying with the primary Ubuntu mirror.'
  sudo timeout --kill-after=10s 120 dpkg --configure -a
  sudo node scripts/ci/linux-apt.mjs fallback
  install_dependencies
fi
# Keep browser binaries in the runner user's Playwright cache, never root's cache.
timeout --kill-after=10s 240 pnpm --filter @dovo/runtime exec playwright install chromium
