# Dovo design system

`packages/design` owns the default Dovo design tokens and trusted hosted-service styles.
`apps/design-system` is the Storybook catalog. It renders the real shared Studio controls, not a
second component implementation.

```sh
pnpm --filter @dovo/design build
pnpm --filter @dovo/design-system dev
# Static, deployable catalog:
pnpm --filter @dovo/design-system build
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
