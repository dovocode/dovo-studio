import * as React from 'react'
import { Switch as UiSwitch, SwitchThumb } from '@ui-sdk/react/switch'
import { cn } from '../../lib/utils'

const Switch = React.forwardRef<
  HTMLButtonElement,
  Omit<React.ComponentPropsWithoutRef<typeof UiSwitch>, 'className' | 'render'> & {
    className?: string
  }
>(({ className, ...props }, ref) => (
  <UiSwitch
    data-slot="switch"
    render={(props, state) => (
      <button {...props} data-state={state.checked ? 'checked' : 'unchecked'} />
    )}
    ref={ref}
    className={cn(
      'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-action data-[state=unchecked]:bg-muted-foreground dark:data-[state=unchecked]:border-muted-foreground dark:data-[state=unchecked]:bg-muted',
      className,
    )}
    {...props}
  >
    <SwitchThumb
      data-slot="switch-thumb"
      render={(props, state) => (
        <span {...props} data-state={state.checked ? 'checked' : 'unchecked'} />
      )}
      className="pointer-events-none block size-4 rounded-full border border-transparent bg-background shadow-sm transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0 dark:data-[state=unchecked]:border-muted-foreground dark:data-[state=unchecked]:bg-foreground forced-colors:border-[ButtonText] forced-colors:bg-[Canvas]"
    />
  </UiSwitch>
))
Switch.displayName = 'Switch'

export { Switch }
