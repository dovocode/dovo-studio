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

# Change checklist

- Cover every entry point: desktop and web, mobile, the command palette, and agent MCP tools when
  agents can use the feature.
- Expect older runtimes. Gate new runtime features behind a snapshot capability flag, such as
  `botsSupported` in `packages/protocol/src/runtime/connection/runtime.ts`, and show a clear
  fallback when the flag is missing.
- Make every state reversible. If a user can turn something on, they can turn it off. A one-way door
  is a bug.
- Test offline and reconnect. Keep drafts, settings and pairings. Recover without new setup.
- Keep HTTP for LAN and VPN runtime addresses, including Tailscale and NetBird. Keep pairing codes
  and device tokens required.
- Update docs in the same change.
- Add a `changelog.d/` fragment when users will notice the change.
- For a bug fix with a test, run `pnpm prove -- <test files>` to show that the test fails without
  the fix.
