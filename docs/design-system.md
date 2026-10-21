# Dovo design system

`packages/design` owns the default Dovo design tokens and trusted hosted-service styles.
`apps/design-system` is the Storybook catalog. It renders the real shared Studio controls, not a
second component implementation.

```sh
pnpm design:dev
# Static, deployable catalog:
pnpm design:build
```

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

Graphite surfaces, restrained blue accent, neutral filled actions, quiet one-pixel borders, 6px
control corners, 12px cards/composer and a 4px spacing scale. Typography uses the shared sans-serif
stack and monospace for codes. Avoid accent-colored glows and gradients on controls or service
chrome. Marketing illustrations may use restrained depth while keeping interactive controls flat and
legible. Use color for interaction, state and selection. User-selected Studio themes remain
supported.

Keyboard focus must remain visible: use a crisp two-pixel indicator on individual controls. The
composer uses a single focused border, not nested rings around both the container and text area.
Toolbar controls retain their own focus indicator. Never fix a glow by removing all focus feedback.
Respect reduced motion, light mode, high contrast and native dynamic type.

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
