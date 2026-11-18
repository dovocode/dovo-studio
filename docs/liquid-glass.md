# Surface materials

Dovo uses solid palette fills for work areas, selected rows, menus and dialogs. The existing
composer and icon-only navigation keep their optical material, including their own portalled
controls. Preserve that scope when adding a surface.

## Rendering

Desktop and web use `packages/web-ui/src/theme.css` and `packages/studio-ui/src/styles.css`. The
optical maps come from [Opaline](https://opaline.buildlab.in/). Its MIT license is in
`packages/studio-ui/src/liquid-glass/OPALINE-LICENSE.txt`. Supported Chromium builds refract the
protected surfaces. Other browsers use a blur fallback where available.

The appearance controller allocates maps only to the protected surfaces. Resizing replaces their
maps. Streaming text keeps the existing maps and input. Higher contrast, Reduce Transparency and
forced colors turn the effect off. The Gradients and Glow preferences still apply.

Native iOS uses its system material for the composer. Workbench controls, navigation backgrounds and
reading panels use solid palette fills. Android uses solid fills and native controls.

## Local checks

Install the managed browser before browser checks:

```sh
pnpm exec playwright install chromium
pnpm test:liquid-glass:browser
node scripts/check-mobile-appearance-browser.mjs
node scripts/check-mobile-sheet-layout-browser.mjs
node scripts/check-mobile-composer-browser.mjs
node scripts/check-mobile-change-summary-browser.mjs
node scripts/check-mobile-task-panes-browser.mjs
node scripts/check-plan-mode-browser.mjs
node scripts/check-image-viewer-browser.mjs
```

The web integration check uses production appearance, composer, change-summary, image-viewer and
command-palette components. It checks optical maps, portal cleanup, resizing, streaming text, dark
and light themes, input identity, draft retention and live accessibility changes. Its screenshots go
to `/tmp/dovo-liquid-glass` by default. Mobile browser checks use native adapters. They do not
establish native rendering.

Capture actual catalog screen compositions in both modes:

```sh
pnpm --filter @dovo/protocol build
pnpm --filter @dovo/web-ui build
pnpm --filter @dovo/client-runtime build
node scripts/capture-ui-polish.mjs /tmp/dovo-opaline --all --only=conversation,settings,appearance,browser
```

Native review needs a Debug app on an authorized Device Hub host. See
[the native review setup](design/browser-and-devices.md#reviewing-this-checkout-on-an-ios-simulator).
A Release app loads its embedded bundle and cannot prove that this checkout works.

To verify native materials, use a build that includes the current checkout and inspect the composer,
a workbench sheet and the settings save bar. Check both themes, large text and Reduce Transparency
on the device. Browser captures do not establish native rendering.
