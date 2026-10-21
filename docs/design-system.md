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
