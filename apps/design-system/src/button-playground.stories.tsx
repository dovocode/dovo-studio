import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useRef, useState, type ComponentProps } from 'react'
import { ArrowRight, LoaderCircle, Plus, Sparkles } from 'lucide-react'
import { Button } from '../../../packages/studio-ui/src/components/ui/button'

type ButtonVariant = NonNullable<ComponentProps<typeof Button>['variant']>
type ButtonSize = NonNullable<ComponentProps<typeof Button>['size']>
type IconPlacement = 'none' | 'leading' | 'trailing' | 'only'
type ButtonPlaygroundArgs = {
  label: string
  variant: ButtonVariant
  size: ButtonSize
  disabled: boolean
  loading: boolean
  iconPlacement: IconPlacement
}

const meta = {
  title: 'Dovo/Button Playground',
  component: Button,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Button wraps a native web button and supports the standard HTML button attributes, plus `variant`, `size`, and `asChild`. Use the controls to preview label, variant, size, disabled/loading state, and icon placement. Loading is a playground-only convenience: the product component has no loading prop, so consumers set `aria-busy` and `disabled` while their action is pending. React Native buttons use platform pressables and accessibility roles.',
      },
    },
  },
  argTypes: {
    label: {
      control: 'text',
      description: 'Visible action label; for icon-only, this becomes its accessible name.',
    },
    variant: {
      control: 'select',
      options: ['default', 'secondary', 'outline', 'ghost', 'destructive', 'link'],
      description: 'Visual hierarchy for the action.',
    },
    size: {
      control: 'select',
      options: ['default', 'sm', 'lg', 'icon'],
      description: 'Built-in button height and padding. Icon-only placement uses icon size.',
    },
    disabled: {
      control: 'boolean',
      description: 'Prevents activation and removes the native button from sequential focus.',
    },
    loading: {
      control: 'boolean',
      description: 'Playground state: announces busy and prevents repeated activation.',
    },
    iconPlacement: {
      control: 'inline-radio',
      options: ['none', 'leading', 'trailing', 'only'],
      description: 'Composed icon position. Icon-only uses the label as aria-label.',
    },
  },
  args: {
    label: 'Create project',
    variant: 'default',
    size: 'default',
    disabled: false,
    loading: false,
    iconPlacement: 'leading',
  },
} satisfies Meta<ButtonPlaygroundArgs>

export default meta
type Story = StoryObj<ButtonPlaygroundArgs>

function iconFor(placement: IconPlacement, loading: boolean) {
  if (loading) return <LoaderCircle className="animate-spin" aria-hidden="true" />
  if (placement === 'leading') return <Sparkles aria-hidden="true" />
  if (placement === 'trailing') return <ArrowRight aria-hidden="true" />
  if (placement === 'only') return <Plus aria-hidden="true" />
  return null
}

export const Controls: Story = {
  name: 'Adjustable button',
  render: ({ label, variant, size, disabled, loading, iconPlacement }) => {
    const [activations, setActivations] = useState(0)
    const iconOnly = iconPlacement === 'only'
    const icon = iconFor(iconPlacement, loading)
    return (
      <div className="grid justify-items-start gap-3">
        <Button
          variant={variant}
          size={iconOnly ? 'icon' : size}
          disabled={disabled || loading}
          aria-busy={loading || undefined}
          aria-label={iconOnly ? label : undefined}
          onClick={() => setActivations((count) => count + 1)}
        >
          {iconPlacement !== 'trailing' && icon}
          {!iconOnly && label}
          {iconPlacement === 'trailing' && icon}
        </Button>
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {loading
            ? 'Busy: activation is disabled until loading ends.'
            : `${activations} activation${activations === 1 ? '' : 's'} in this preview.`}
        </p>
        <Button variant="ghost" size="sm" onClick={() => setActivations(0)}>
          Reset activation count
        </Button>
      </div>
    )
  },
}

export const ActionHierarchy: Story = {
  render: () => (
    <div className="grid max-w-xl gap-4">
      <p className="text-sm text-muted-foreground">
        Give the primary action the strongest treatment; keep secondary and destructive actions
        distinct.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button>Save changes</Button>
        <Button variant="outline">Preview</Button>
        <Button variant="ghost">Cancel</Button>
        <Button variant="destructive">Delete draft</Button>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Use one primary action for the expected next step. A destructive variant signals impact but does not replace confirmation when an action is consequential. Buttons activate with Enter or Space when focused.',
      },
    },
  },
}

export const LoadingPreventsDuplicateActivation: Story = {
  render: () => <LoadingAction />,
  parameters: {
    docs: {
      description: {
        story:
          'A pending action sets aria-busy and disables the button so repeated clicks cannot submit it again. Reset cancels this local timer and restores the initial state. No network request is made.',
      },
    },
  },
}

function LoadingAction() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const run = () => {
    if (loading) return
    setLoading(true)
    setResult('Saving preferences…')
    timer.current = setTimeout(() => {
      timer.current = null
      setLoading(false)
      setResult('Saved once. You can run it again.')
    }, 900)
  }

  const reset = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setLoading(false)
    setResult('')
  }

  return (
    <div className="grid justify-items-start gap-3">
      <div className="flex items-center gap-3">
        <Button onClick={run} disabled={loading} aria-busy={loading || undefined}>
          {loading && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          {loading ? 'Saving…' : 'Save preferences'}
        </Button>
        <Button variant="ghost" onClick={reset}>
          Reset
        </Button>
      </div>
      <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
        {result || 'Press Save preferences to start the local loading preview.'}
      </p>
    </div>
  )
}

export const NamedIconAction: Story = {
  render: () => (
    <div className="grid justify-items-start gap-3">
      <Button size="icon" variant="outline" aria-label="Add project">
        <Plus aria-hidden="true" />
      </Button>
      <p className="text-sm text-muted-foreground">
        Accessible name: <code>Add project</code>. The plus icon is decorative.
      </p>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Icon-only buttons need an accessible name even when a tooltip or nearby text explains the action visually. Keep the SVG hidden from assistive technology so the button name is announced once.',
      },
    },
  },
}
