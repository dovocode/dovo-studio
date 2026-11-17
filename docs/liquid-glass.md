# Liquid glass

Dovo uses one Opaline material for the app frame. Navigation, the sidebar brand header, thread
header, composer, menus and dialogs share it in light and dark mode. The header also covers the
corner above the activity rail. Selected navigation items and thread rows use tinted glass with a
location marker. Cards, content panes and changed-file summaries use the same material. Code and
inner controls keep solid fills. User palettes stay available.

## Rendering

Desktop and web use the shared CSS in `packages/web-ui/src/theme.css` and
`packages/studio-ui/src/styles.css`. Supported Chromium browsers add SVG backdrop refraction. Other
engines use an 8px frosted fallback. A browser without backdrop filters uses an opaque fill. Hosted
pages retain their existing plain layout.

The web optical map code comes from [Opaline](https://opaline.buildlab.in/). Its MIT license is in
`packages/studio-ui/src/liquid-glass/OPALINE-LICENSE.txt`. The source is vendored in `optics.ts`. No
network request or new package is needed at runtime. `designTokens.glass` defines the optical
settings.

Dialogs, including image previews, use the same optical material. Their overlay dims the page
without blurring it first, so the dialog can refract background detail. Image zoom and pan controls
keep their existing behavior. Dialog fills use 56% palette color, with the page visible through the
rest. Higher contrast and Reduce Transparency restore an opaque fill.

The appearance hook starts one shared controller. It adds filters to material containers and portal
menus. Size changes replace maps after image decoding. Removed or hidden surfaces release their
filters. Text streaming does not rebuild maps. The controller keeps existing input elements and does
not change drafts, selection or runtime connections.

Higher contrast, system Reduce Transparency and forced colors use opaque fills. They also release
optical resources. Turning the preference off restores glass. The existing Gradients and Glow
preferences still control painted effects. They are not required for refraction. Keyboard focus
keeps its own visible indicator.

## Mobile settings

Native iOS uses `expo-glass-effect` with its regular system material. The same native parent stays
mounted when appearance or accessibility preferences change. Android and unsupported iOS versions
use solid palette fills. These are expected platform fallbacks. Web SVG refraction does not run
inside native React Native.

Settings use grouped rows and platform pickers or switches. Tool calls appear inline without a glass
panel. Native changed-file summaries, thread info, review findings and plan approval use the shared
Glass wrapper. Selected threads and change categories use a tinted glass layer behind the existing
controls. Native iOS navigation retains its system glass. The floating settings save bar uses the
shared glass wrapper. Scope labels, search, pending edits and save rules keep their existing
behavior. Form text uses the larger shared settings text size.

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

Native builds for this change have not been verified. Device Hub booted the Mac Studio review
simulator, but SSH to the build host failed host-key verification. The installed simulator apps do
not establish behavior for this checkout.

## Verification for this change

Local production desktop and web builds passed. Design, Studio UI, Studio shell, mobile and catalog
typechecks passed. Mobile theme and draft tests passed with 55 tests. The material integration check
passed, including dynamic pane classes, corner changes, selection changes, inline review pane mounts
and cleanup, image dialogs and the flat composer inside dialogs.

Both existing appearance browser checks passed. The full suite covers 34 palette and mode
combinations. Mobile appearance, sheet layout and composer harnesses passed through adapted native
components. These checks cover draft, focus and caret retention, failed-send recovery, large text
and save or close guards. Mobile change-summary, adaptive task-pane and plan-mode harnesses also
passed. Image-viewer checks passed fit, actual pixels, wheel zoom, drag, keyboard and pinch.

Eight production catalog screen compositions were captured across conversation, settings, appearance
and Browser in light and dark mode. Further captures cover selected threads, file panes, PR changes
and image-preview dialogs in both modes. They use synthetic data and blocked runtime writes. They do
not verify a live provider, account or native browser bridge. Native device rendering and actual
Safari or Firefox rendering remain unverified.
