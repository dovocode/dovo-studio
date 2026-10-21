import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { designTokens, semanticColors, colorVisionColors } from '@dovo/design'
import { Button } from '../../../packages/studio-ui/src/components/ui/button'
import { Switch } from '../../../packages/studio-ui/src/components/ui/switch'
import { IconButton } from '../../../packages/studio-ui/src/components/icon-button'
import { TooltipProvider } from '../../../packages/studio-ui/src/components/ui/tooltip'
import { ProjectIcon } from '../../../packages/studio-ui/src/project-icon'

const meta = {
  title: 'Dovo/Anatomy',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'The elements beneath a component: semantic color, typography, surfaces, focus and hit area. These examples use the same tokens and primitives as the applications. Geometry may adapt to native platform conventions; meaning and behavior must not.',
      },
    },
  },
} satisfies Meta
export default meta

export const Typography: StoryObj = {
  render: () => (
    <section className="grid max-w-3xl gap-6" aria-label="Typography scale">
      <div>
        <p className="text-xs text-muted-foreground">Display / marketing · 36px</p>
        <h1 className="text-4xl font-semibold tracking-tight">Your workspace, everywhere.</h1>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Page title · 24px</p>
        <h2 className="text-2xl font-semibold tracking-tight">Connected computers</h2>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Section · 20px</p>
        <h3 className="text-xl font-semibold">Connection settings</h3>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Body · 14–16px</p>
        <p className="text-sm leading-relaxed">
          Use Dovo Connect for relay fallback. Pairing remains available over your private network.
        </p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Control label · 13px / medium</p>
        <span className="text-[13px] font-medium">Enable relay fallback</span>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Metadata · 12px, full muted-color opacity</p>
        <p className="text-xs text-muted-foreground">Updated just now · Wi-Fi · Dovo Direct</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Codes / identifiers · monospace</p>
        <code className="break-all font-mono text-sm">
          dovo-agent / apps/mobile / feature/connection-settings
        </code>
      </div>
      <p className="text-sm text-muted-foreground">
        Native body text remains 15px or platform-scaled. Never disable dynamic type to force a
        browser match. Headings follow document hierarchy, not their visual size.
      </p>
    </section>
  ),
}

function StateRoles({ mode }: { mode: 'dark' | 'light' }) {
  const [alternate, setAlternate] = useState(false)
  const colors = alternate ? colorVisionColors[mode] : semanticColors[mode]
  return (
    <section className="grid max-w-2xl gap-5">
      <label className="flex min-h-11 items-center gap-3">
        <Switch checked={alternate} onCheckedChange={setAlternate} />
        Blue/orange color-vision palette
      </label>
      <div className="grid gap-3 rounded-xl border bg-card p-6">
        <p style={{ color: colors.success }}>✓ Connected — authenticated data is flowing.</p>
        <p style={{ color: colors.warning }}>! Reconnecting — your changes are preserved.</p>
        <p style={{ color: colors.error }}>× Access revoked — sign in again to reconnect.</p>
        <Button
          variant="destructive"
          style={{ backgroundColor: colors.error, color: colors.onError }}
        >
          Destructive action sample
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Every state has text and a distinct symbol. Red is for failure or destructive action, not an
        ordinary selection. Status does not become a live announcement unless it actually changes
        during an operation.
      </p>
    </section>
  )
}
export const SemanticRoles: StoryObj = {
  render: (_, context) => (
    <StateRoles mode={context.globals.theme === 'light' ? 'light' : 'dark'} />
  ),
}

export const SurfaceLayers: StoryObj = {
  render: () => (
    <section className="grid max-w-3xl gap-6">
      <div className="rounded-xl border bg-background p-6">
        <h2 className="text-lg font-semibold">1. Workspace canvas</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Background establishes the application surface.
        </p>
        <div className="mt-6 rounded-xl border bg-card p-6">
          <h3 className="font-medium">2. Grouped content</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            A quiet one-pixel divider and 12px card radius group related settings.
          </p>
          <div className="mt-4 rounded-md border bg-popover p-4">
            <strong className="text-sm">3. Elevated surface</strong>
            <p className="mt-2 text-sm text-muted-foreground">
              Menus use the popover surface and appropriate stacking. A blue glow is never
              elevation.
            </p>
          </div>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Borders organize adjacent surfaces; keyboard focus uses a separate {designTokens.focusWidth}
        px indicator. Do not depend on a low-contrast border as the only affordance for an
        interactive control.
      </p>
    </section>
  ),
}

export const SpacingAndTargets: StoryObj = {
  render: () => (
    <section className="grid max-w-3xl gap-6">
      <div className="flex flex-wrap items-end gap-6">
        {Object.entries(designTokens.spacing).map(([name, size]) => (
          <div key={name}>
            <div style={{ width: size, height: size, background: 'var(--primary)' }} />
            <p className="mt-2 text-xs">
              {name} · {size}px
            </p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Button size="sm">Compact</Button>
        <Button>Default</Button>
        <Button size="lg">Prominent</Button>
        <Button size="icon" aria-label="Add example">
          +
        </Button>
      </div>
      <div className="rounded-xl border p-4">
        <h2 className="font-medium">Visible shape ≠ touch target</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Mouse controls can be compact. Coarse-pointer buttons and fields have a minimum 44px
          target. Native icon controls and labeled toggles keep at least 44 points; a 16px checkbox
          glyph needs a larger clickable label.
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        Use the Storybook viewport tools for layout. Device emulation is needed to test pointer
        type; a narrow desktop window alone is still a mouse environment.
      </p>
    </section>
  ),
}

function IconSemantics() {
  const [opened, setOpened] = useState(false)
  return (
    <TooltipProvider>
      <section className="grid max-w-xl gap-5">
        <div className="flex items-center gap-2">
          <ProjectIcon />
          <span className="text-sm">Project title supplies the accessible name</span>
        </div>
        <div className="flex items-center gap-4">
          <IconButton label="Open example project" onClick={() => setOpened(true)}>
            <ProjectIcon />
          </IconButton>
          <Button variant="outline" onClick={() => setOpened(true)}>
            <ProjectIcon />
            Open project
          </Button>
        </div>
        {opened && (
          <p role="status" className="text-sm">
            Example project opened locally.
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          Decorative icons are hidden from assistive technology. Icon-only buttons need an explicit
          accessible name; a tooltip is supplementary. Keep icons 16px in ordinary controls and
          avoid adding color when the label already conveys the action.
        </p>
        <Button variant="ghost" onClick={() => setOpened(false)}>
          Reset example
        </Button>
      </section>
    </TooltipProvider>
  )
}
export const IconSemanticsAndLabels: StoryObj = { render: () => <IconSemantics /> }

export const MotionAndFocus: StoryObj = {
  render: () => (
    <section className="grid max-w-xl gap-4">
      <h2 className="text-lg font-semibold">Feedback follows intent</h2>
      <p className="text-sm text-muted-foreground">
        Tab to the controls below: each has one crisp focus indicator. Hover and press feedback stay
        restrained; reduced motion removes transitions. Focus must remain visible in high-contrast
        themes.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button>Primary action</Button>
        <Button variant="outline">Secondary action</Button>
        <Button variant="ghost">Toolbar action</Button>
      </div>
      <p className="text-sm text-muted-foreground">
        A field inside the composer uses its container’s focused border. Toolbar buttons retain
        individual focus. Modal focus is trapped until dismissal and returns to its trigger.
      </p>
    </section>
  ),
}
