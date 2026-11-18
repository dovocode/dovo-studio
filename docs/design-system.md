# Dovo design system

`packages/design` owns the default Dovo design tokens and trusted hosted-service styles.
`apps/design-system` is the Storybook catalog. It renders the real shared Studio controls, not a
second component implementation.

```sh
pnpm design:dev
# Static, deployable catalog:
pnpm design:build
```

The catalog prepares the generated mobile Terminal, Remote Desktop and Mermaid assets before
building. It does not depend on a mobile build running first.

The public catalog is hosted separately at `https://ui.dovo.studio`. Its deployment uses
`apps/design-system/compose.dokploy.yaml` with the repository root as Docker build context. Only
synthetic examples belong in the public catalog; never include account data or credentials. The
static catalog is written to `apps/design-system/storybook-static`. Storybook's theme toolbar
switches the default Dovo palette between dark and light modes. Its accessibility panel checks
rendered examples. Test keyboard traversal, pointer behavior, loading/disabled/error states and
narrow viewports before shipping component changes.

## Ownership

- **Colors and geometry:** `packages/design/src/tokens.ts`. CSS custom properties are generated
  during the package build; do not copy or edit generated `dist/tokens.css`.
- **Desktop and web controls:** existing components in `packages/studio-ui`. Add stories for new
  shared components here instead of inventing a parallel catalog-only version.
- **Native mobile:** `apps/mobile/src/ui`, using Studio's shared palette. Native controls keep
  platform behavior, text scaling and at least 44-point touch targets. Browser stories are
  references, not a substitute for iOS/Android device verification.
- **Website:** imports shared token CSS and keeps its editorial layout.
- **Auth, Connect and Artifacts:** use `hostedStyles` for their trusted page chrome, with each
  service retaining its own content, layout, consent and security policy. Never apply service styles
  to publisher-controlled sandbox contents.

## Visual language

Studio takes its surface styling from [Opaline](https://opaline.buildlab.in/installation/): soft
edge highlights, frosted menus and dialogs, rounded actions and restrained depth. Keep the selected
Studio palette. Shared tokens use 10px field corners, 16px cards and a 4px spacing scale. Text
actions use capsule shapes.

Non-settled thread rows have two lines and a leading project icon. Put the title and status on the
first line. Put the project, branch, linked PR shortcut, harness icon and computer icon on the
second line. Keep the title and project visible in the tooltip and accessible details when space is
limited. A single PR shortcut opens that PR on its owning computer. A count opens the linked PR
list. Keep native mobile controls at least 44 points high and use the compact settled row for
settled threads. The selected thread exposes the full machine and harness names in the header or
Thread info.

Branch truncation adapts T3's `MiddleTruncate` at
[`8ee7183e6c8a`](https://github.com/pingdotgg/t3code/blob/8ee7183e6c8a1c22a6698f4909ef7e2a423bec3a/apps/web/src/components/ui/middle-truncate.tsx).
It keeps a short suffix at a word boundary, cuts the prefix at a whole character and places the
ellipsis directly against the suffix. Resizing refits the text without changing the full name in the
tooltip, accessible label or copy text. The MIT notice is included in **Settings → About → Open
source notices**.

Unified shows a type badge at the bottom right of the leading project icon or favicon for a thread,
browser tab or terminal. The badge also appears on pinned browser tiles. Keep the type in the row's
accessible identity.

Build and check the real sidebar with synthetic runtime data. Add the preview variable to save
light, dark and narrow examples:

```sh
pnpm exec playwright install chromium
pnpm --filter @dovo/desktop build
node scripts/check-shared-controls-appearance-browser.mjs
DOVO_SIDEBAR_PREVIEWS=/tmp/dovo-sidebar-t3-previews node scripts/check-sidebar-rendering-browser.mjs
node scripts/check-desktop-audit-layout-browser.mjs
```

Pinned browser tabs use 40px tiles and a centered 24px favicon on desktop and web. Status and
activity stay in the corners. Regular tabs show the title above the site and linked project or
profile. Computer and session details stay available in the accessible name and tab details. Reserve
a fixed slot for tab actions so the text does not move on hover or focus. Touch devices keep those
actions visible. The desktop activity bar has a 6px left inset.

Work areas use the palette's solid background. Give titles, body text and metadata distinct weights.
Use spacing between groups and inset dividers within related rows. Keep icons compact and provide a
visible keyboard focus indicator. Maintain comfortable touch targets. Use a text label for actions
that start work or change state. Keep the title and action in the same place through loading and
refresh. Preserve the active item and the user's position when returning from details.

On desktop and web, `packages/web-ui/src/theme.css` owns the dialog and menu styles.
`packages/studio-ui/src/styles.css` owns collection and workbench layouts. Use solid palette fills
for the composer, navigation, and overlays. Keep the Gradients and Glow preferences for the
appearance effects they still control. See [Surface materials](liquid-glass.md) for checks.

UI SDK supplies the shared desktop and web checkbox, switch, collection filter and review tab
behavior. Use the Dovo components so typography, focus styles and form contracts stay consistent.
Use native controls on mobile. Keep menus and sheets small enough to reach every action with a
keyboard or larger text.

Use solid native surfaces for the composer, browser controls, reading panes, change summaries, and
settings actions. Keep the native navigation gestures. Use the same grouping and control sizes on
Android. Sticky settings actions name the scope and keep save and discard available while the form
scrolls.

Collection and detail routes consume the native safe areas once. Browser adapters check these edge
choices and draft retention. Verify inset sizes, larger text, gestures and screen reader behavior on
a native device.

Thread info floats inside the conversation. It does not resize chat or open the tools sidebar. Keep
it inset from the thread edges and above the composer. Its header stays fixed while sections scroll.
Closing Info preserves composer setting drafts. Customize replaces the panel content without
changing its bounds. Use a solid background for Thread Info and its customization panel on desktop
and web, and for inline Thread Info on mobile. Text-only icon tips must not intercept clicks on
adjacent controls.

Check mobile surfaces and controls with:

```sh
pnpm --filter @dovo/mobile typecheck
pnpm exec playwright install chromium
node scripts/check-mobile-appearance-browser.mjs
node scripts/check-mobile-browser-toolbar-browser.mjs
node scripts/check-mobile-settings-layout-browser.mjs
node scripts/check-mobile-composer-actions-browser.mjs
node scripts/check-mobile-workspace-browser.mjs
node scripts/check-mobile-tabbar-browser.mjs
```

These browser checks use native adapters. They check layout, fallback styles, actions and input
identity. They do not prove native refraction or touch behavior. Inspect the production surfaces in
an iOS simulator and on a device in light and dark mode. Check high contrast and Reduce
Transparency. Keep an unsaved draft focused while changing appearance. Confirm that its text and
caret stay put.

Settings rows keep 16px of space at both card edges and 12px above and below their content. Keep
this inset when controls move below labels in a narrow pane. Dividers span the card width.

Center **Scroll to latest message** in its conversation pane. Inline chat images show **Edit &
attach** over the image on hover or keyboard focus. Touch screens keep this action visible with a
44px minimum height. Revealing the action must not move the image or the conversation. A turn jump
or reader gesture stops following. Shrinking deferred content and queued native scroll events must
not restart it. Keep following paused through deferred layout changes until a turn jump settles. An
explicit **Scroll to latest message** action resumes following.

Typography uses the shared sans-serif stack and monospace for codes. Use color for interaction,
state and selection. User-selected Studio themes remain supported.

Keyboard focus must remain visible: use a crisp two-pixel indicator on individual controls. The
composer uses a single focused border, not nested rings around both the container and text area.
Place checklist and queue above the input box. Attach their lower edge to its top border. Inset both
sides by 24px on desktop and 20px on mobile. Keep the input's rounded top corners. Do not put
activity inside the input box. Toolbar controls retain their own focus indicator. Never fix a glow
by removing all focus feedback. Respect reduced motion, light mode, high contrast and native dynamic
type.

Threads, Unified workspace, Browser and Terminal use the Threads starter layout: one shared heading,
composer width, focus border and compact control rows. Keep each starter's launch logic with its
workspace. Browser's main **+** opens a blank page directly. Its adjacent menu retains profile,
private-tab and window choices. The central address and toolbar share one draft. Terminal creation
stays inline and retains its command and checkout choices when the user returns to an open session.
Returning does not close the shell. A launch that finishes in the background opens its result when
the user returns to the starter. Unified keeps Auto and explicit destinations. Its Terminal
destination uses the same home, project, local checkout, existing worktree and new worktree choices
as Terminal. An explicit Terminal destination can open an empty shell. Auto still needs a request.

Check starter navigation and launch behavior with:

```sh
pnpm exec playwright install chromium
pnpm --filter @dovo/desktop build
pnpm --filter @dovo/extension-tasks typecheck
node scripts/check-unified-workspace-browser.mjs
node scripts/check-browser-tabs-browser.mjs
node scripts/check-shared-browser-browser.mjs
```

These browser fixtures check UI behavior and runtime request payloads. They do not verify a live
Electron browser or a real shell on a paired computer. Review all four starters in light and dark
themes with Glow at 50%, including narrow and short windows, before pushing visual changes.

Verify shared surface changes with:

```sh
pnpm --filter @dovo/design --filter @dovo/web-ui build
pnpm --filter @dovo/desktop build
pnpm --filter @dovo/web build
pnpm exec playwright install chromium
node scripts/check-shared-controls-appearance-browser.mjs
node scripts/check-general-settings-browser.mjs
node scripts/check-settings-target-browser.mjs
node scripts/check-layout-stability-browser.mjs
node scripts/check-unified-workspace-browser.mjs
node scripts/check-mobile-settings-layout-browser.mjs
node scripts/check-image-attachments-browser.mjs
node scripts/check-thread-scroll-browser.mjs
```

Keep primary actions, danger actions, disabled states, empty states and errors explicit. Dense
mouse-oriented desktop controls may be smaller, while coarse-pointer controls need larger targets.
The catalog's service examples are presentation-only and contain no production credentials.

Use the shared `Button` variants: `default` for the primary action, `outline` for cancellation or
secondary form actions, `secondary` for a quiet filled action, `ghost` for toolbars, `link` for
inline navigation and `destructive` for confirmed deletion. Keep hover feedback restrained, keyboard
focus crisp, and loading or disabled labels readable. Hosted controls follow the same
filled/outlined hierarchy; native actions retain platform touch feedback and confirmation sheets.

## Catalog depth

The catalog is organized by responsibility rather than by application:

| Layer                      | What to inspect                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Foundations and anatomy    | Semantic color roles, typography, icon naming, surfaces, borders, spacing, touch targets, motion and focus                      |
| Primitives                 | Button variants/sizes, named icon actions, inputs, textareas, mixed checkboxes, switches, selects, dialogs, tooltips and badges |
| Form and settings patterns | Labels and help, validation, responsive settings rows, permissions, destructive confirmation and long content                   |
| Content and navigation     | Page identity, projects, file trees and change counts, empty/error/progress, messages, tools and queues                         |
| Hosted services            | Actual Auth, Connect and Artifacts templates with synthetic data; scoped consent and account-session UI                         |

A story must state which layer owns behavior. A badge is not a button; a tooltip does not supply a
missing accessible name; a color is not a status announcement. Demonstrate the actual component, not
a styled screenshot or a second implementation. Stateful examples operate locally and must not
contact a runtime or publish data. Use the existing Lucide icon family rather than inventing a
catalog-only icon set.

Check unchecked/checked/mixed, idle/loading/disabled, valid/invalid/read-only, selected/unselected,
empty/populated/overflow and closed/open states where they apply. Modal examples must demonstrate
focus containment, Escape dismissal and focus return; selects and checkboxes must work from the
keyboard. Coarse-pointer controls need real touch emulation, not only a narrow browser viewport.
Keep native control behavior and Dynamic Type visible in reviews; browser coverage remains separate
from the physical-device checklist.

`pnpm test:design-system:browser` checks all catalog stories in both palettes at desktop and phone
widths, audits accessibility, and exercises mixed selection, keyboard choice, modal focus,
destructive confirmation and coarse-pointer targets. To apply the same checks to a deployed build:

```sh
DOVO_DESIGN_ORIGIN=https://ui.dovo.studio node scripts/check-design-system-browser.mjs
```

### Sharding the catalog check

The sequential run covers every story in both palettes at both widths plus the hosted inner-frame
matrix, then one pass of catalog interactions. CI splits the two matrices across jobs; each shard
owns a disjoint, round-robin slice and the slices together cover every case exactly once
(`scripts/ci/design-system-shards.mjs`, verified by `scripts/ci/design-system-shards.test.mjs`).
Interactions are not a matrix and run once per CI run: the browser job runs them with
`DOVO_DESIGN_INTERACTIONS_ONLY=1`, or one nominated shard runs them with
`DOVO_DESIGN_INTERACTIONS=1`.

```sh
# One of four shards: story and hosted matrix slices only (interactions skipped)
DOVO_DESIGN_SHARD=2 DOVO_DESIGN_SHARD_COUNT=4 pnpm test:design-system:browser
# Same selection on the command line; positional arguments win over the environment
pnpm test:design-system:browser 2 4
# Nominate a shard to also run the single interactions pass
DOVO_DESIGN_INTERACTIONS=1 pnpm test:design-system:browser 0 4
# Interactions only (what the browser job runs); cannot be combined with a shard selection
DOVO_DESIGN_INTERACTIONS_ONLY=1 node scripts/check-design-system-browser.mjs
# Local full run: everything, unsharded (optionally DOVO_DESIGN_INTERACTIONS=0 for the matrix only)
pnpm test:design-system:browser
```

Invalid selections (missing count, index outside `0..count-1`, non-integers, interactions-only with
a shard) fail before a browser launches. Sharded runs write their axe report to
`dovo-design-system-accessibility-<shard>-of-<count>.json` in the temp directory.

## Task interaction ownership

Find the full interactive example under **Dovo / Composers / Production task composer**. It covers
new, idle, running, disconnected, long-draft and failed-send states. The conversation examples use
the real message queue for editing, reordering and pause/resume; question and permission examples
use their production controls. Included attachment bytes are synthetic; uploads, image edits, branch
changes and queue steering explicitly fail in the local preview.

The complete task composer lives in `packages/extension-tasks/src/chat/composer/composer.tsx`. Its
editor, attachments, context suggestions, harness controls and workspace bar stay with their
production owners. The smaller Controls / Composer surface anatomy story explains the shared shell;
it does not stand in for the full task flow.

Task stories use a synthetic workspace adapter instead of opening a runtime connection. Request
results are decoded with the actual protocol schemas. Supported actions update only the preview;
unsupported actions must fail visibly. Do not return a successful response for an operation the
preview did not perform. Keep request callbacks stable, restore any changed preferences on unmount,
and never include production credentials, production filesystem paths, account data or runtime URLs
in these fixtures. Question answers and permission edits are local examples, never authorization
grants.

## Build consistent product screens

Start with **Dovo / Build screens / Component map**, then open the production thread, pull-request,
review or composer pattern. The catalog is a working reference for component selection and behavior,
not a source of copied markup. Storybook controls vary the real component inputs; local fixture
state stands in for runtime/forge state without granting permissions or contacting either service.

| Product responsibility             | Production owner                                              | Composition rule                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Thread cards and navigation        | `extension-tasks/src/list/task-row.tsx`                       | Keep title/status first, project/runtime/model secondary, and nested threads and lifecycle actions distinct.              |
| List selection and menus           | `extension-tasks/src/list/task-list-row.tsx`                  | Let the list own selection/navigation and its existing interaction wrapper; preserve keyboard and nested-action behavior. |
| Pull request identity and checks   | `extension-tasks/src/detail/task-pull-status.tsx`             | Keep draft/open/merged/closed separate from pending/passed/failed checks; use labels alongside semantic color.            |
| Linked pull requests               | `extension-tasks/src/detail/task-linked-pull-panel.tsx`       | Compose the existing status component; keep empty/disconnected states and per-item actions explicit.                      |
| Independent review                 | `extension-tasks/src/review`                                  | Preserve severity, finding status, file/line context, stale-review state and remediation ownership.                       |
| Screen identity and content states | `studio-ui/src/page-header.tsx`, `components/empty-state.tsx` | Keep a stable page heading, one primary action, contextual retries and clear loading/error/empty content.                 |

Use polished button variants consistently: the primary action is the next productive step; outline
is a secondary action, ghost is a quiet local action, and destructive is reserved for removal or
revocation. Status badges are information, not controls. Selection, hover, unread activity and
failure are separate states; do not reuse one accent treatment for all of them.

At flex/grid boundaries use shrinkable content (`min-w-0` and `minmax(0, 1fr)` tracks) before
truncating text. Truncation inside a content-sized parent does not prevent page overflow.

Desktop can expose denser metadata. Narrow and touch layouts can wrap or move secondary details, but
must retain identity, status, active selection and access to actions. Long branches, titles,
repository names and findings belong in the examples. Keep loading, empty, disconnected, stale,
failure and cancellation distinct when the production component supports them. Browser examples do
not replace native Dynamic Type, context-menu and touch testing.

Native counterparts live in `apps/mobile/src/tasks/list/task-list-row.tsx`,
`tasks/detail/pull-status.tsx`, `tasks/detail/task-linked-pull-sheet.tsx` and
`scm/review/code-review-report.tsx`. Review these alongside the browser patterns when changing
hierarchy, labels or states. Preserve native sheets, platform context menus and text scaling rather
than importing DOM components into React Native. The browser catalog does not claim to render those
native implementations.

## Mobile component catalog

The **Dovo / Mobile** interactive browser stories import the production mobile components and use
React Native Web for browser layout and interaction. PR review status is native-only because its
production Markdown renderer depends on native modules; its web entry explains how to open the real
story rather than replacing the renderer. Keep the mobile component as the owner; do not copy
browser fixture markup into the native app. The preview is an additional rendering target, not an
iPhone screenshot or a replacement for native review.

- `apps/mobile/src/ui/controls` owns native actions, fields, search, choices, pills and switches.
- `apps/mobile/src/screens/settings-group.tsx` owns grouped navigation rows and switch rows;
  `settings-controls.tsx` and `settings-theme.tsx` own settings editing and presentation.
- `apps/mobile/src/tasks/composer/composer-field.tsx` owns the mobile multiline draft input.
  `question-field.tsx` owns single/multiple choice and custom-answer interaction. The conversation
  stories exercise these inputs with local draft/send simulation; they do not render the full mobile
  composer or perform an agent send.

Keep state in the feature: save/cancel must distinguish the edited draft from its committed value,
failed saves must retain input, and a disabled control must have an understandable reason. Respect
the existing 44-point minimum hit areas. A narrow browser viewport does not simulate Dynamic Type, a
software keyboard, VoiceOver, native gesture cancellation, UIKit navigation, glass controls or
SwiftUI menus. Review those on the device separately. Catalog platform adapters must never return a
successful native operation; unsupported native code paths should fail explicitly.

### Native Storybook on the Mac Studio

Run `pnpm --filter @dovo/mobile storybook:ios --device "Dovo UI Review"` on a Mac with the project's
normal Expo/Xcode dependencies installed. `pnpm --filter @dovo/mobile storybook` starts Metro alone
when the simulator binary already exists. Both commands regenerate the native story registry first.
Expo 58 already enables Metro `require.context`; no second Metro configuration or runtime-provider
mocks are needed. Storybook is guarded by `__DEV__` and the explicit `EXPO_PUBLIC_DOVO_STORYBOOK=1`
flag. Release builds always use the normal app entry.

Use the native Storybook menu to select controls, settings, conversation inputs, nested thread
activity or pull-request review status. Controls and settings share their React Native fixtures with
the website catalog. Native choices and presentation use the real iOS implementations; there are no
SwiftUI stubs in the simulator. The web catalog has explicit fail-fast boundaries for those
native-only branches. The full mobile task row and full mobile composer are not yet catalogued:
their runtime, model-cache, lifecycle, attachment and dictation integration still belongs in
app-level/device checks.

The native settings examples are isolated local state, including save failure, cancellation and
forget confirmation. They must never connect, change account access, delete a real pairing or grant
permissions. Native review must check the body and actions of a confirmation, not only its title:
flexible sheet bodies must not collapse inside a dialog sized to its content.

The **Mobile / Native simulator** web story contains dated captures from the actual Mac Studio iOS
simulator. They are visual references, not interactive native tests or a claim of full-screen
coverage. The reviewed simulator installation uses a separate application ID and leaves the normal
Dovo app and its pairings untouched. The development commands above use the normal Expo app
identity; run them on the dedicated review simulator, not a device with a pairing you want to
preserve.
