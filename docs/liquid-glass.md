# Surface materials

Dovo uses solid palette fills for the composer, navigation, menus, dialogs, and browser controls.
Desktop and web define these fills in `packages/web-ui/src/theme.css` and
`packages/studio-ui/src/styles.css`. Mobile uses the shared `Surface` component and native controls.
The Gradients and Glow preferences still apply to the appearance effects that use them.

## Local checks

```sh
pnpm exec playwright install chromium
pnpm test:solid-surfaces:browser
node scripts/check-mobile-appearance-browser.mjs
node scripts/check-mobile-composer-actions-browser.mjs
node scripts/check-mobile-sheet-layout-browser.mjs
```

The desktop and web check covers both themes, draft identity, and keyboard interactions. It writes
screenshots to `/tmp/dovo-solid-surfaces`. The mobile checks use browser adapters.

Use a Debug build from this checkout to verify native rendering. Inspect the composer, tab bar, a
sheet, and the settings save bar in both themes. Check larger text and Reduce Transparency.
[Native review setup](design/browser-and-devices.md#reviewing-this-checkout-on-an-ios-simulator)
