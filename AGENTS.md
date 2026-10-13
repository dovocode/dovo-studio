# Runtime connectivity policy

- Keep HTTP supported for LAN and VPN connections, including Tailscale and NetBird. Never require
  HTTPS or silently upgrade an HTTP runtime address. HTTPS remains optional.
- Keep pairing codes and device tokens required. Do not introduce a mandatory account, external
  identity provider, or login service.
- These are deliberate product requirements. Security improvements must preserve both policies.
- Work with one coding agent unless Dominic explicitly requests otherwise. Preserve existing
  working-tree changes.

# Browser verification

- Always install Chromium through Playwright before running browser checks:
  `pnpm exec playwright install chromium`. Use Playwright's managed browser, rather than a system
  Chromium installation. If Linux system dependencies are missing, use
  `pnpm exec playwright install --with-deps chromium`.
