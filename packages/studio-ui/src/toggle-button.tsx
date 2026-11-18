import { Toggle } from '@ui-sdk/react/toggle'
import type { ComponentPropsWithoutRef } from 'react'
import { Button } from './components/ui/button'

export function ToggleButton({
  children,
  pressed,
  onPressedChange,
  ...props
}: Omit<ComponentPropsWithoutRef<typeof Button>, 'asChild' | 'onClick' | 'aria-pressed'> & {
  pressed: boolean
  onPressedChange: (pressed: boolean) => void
}) {
  return (
    <Toggle pressed={pressed} onPressedChange={onPressedChange} render={<Button {...props} />}>
      {children}
    </Toggle>
  )
}
