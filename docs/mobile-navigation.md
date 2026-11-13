# Mobile navigation

Tasks shows Bots above the thread groups. Use **+** at the end of the Bot row to open Bot creation
and choose its host computer. The empty row keeps **+**. Creation needs a connected computer with
Bot support. Pin a Bot through its touch-and-hold menu.

Choose **Bot layout** in **Settings → Appearance**: Horizontal row (default), 2 columns, 3 columns,
or Rows. The choice stays on this device. Desktop has the same choices.

Search starts hidden. Scroll up to show it, or use the keyboard search shortcut. Scroll down to hide
it. Search stays visible while focused or while its query is nonempty. Switching tabs keeps the
query and list position.

Browser and Terminal appear in the bottom tabs only when enabled in **Settings → General →
Experimental**. Car mode hides both. PRs keeps its bottom tab. The header's More menu opens the
other tools and Settings. Mobile has no Unified overview or top mode bar. Old `/workspace`,
`/workspace/new` and `/workspace/browser` links open Tasks, New thread and Browser respectively.
Saved browser tabs, terminal sessions, drafts and computer pairings remain intact.

Verify with:

```sh
pnpm exec playwright install chromium
node scripts/check-mobile-tabbar-browser.mjs
node scripts/check-mobile-task-list-rendering-browser.mjs
node scripts/check-mobile-bots-browser.mjs
pnpm --filter @dovo/mobile typecheck
node scripts/check-mobile-metro-modules.mjs
```

Browser fixtures use native control adapters. They do not verify native tab layout or iPhone
gestures.
