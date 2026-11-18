'use client'

import * as React from 'react'
import { Checkbox as UiCheckbox, CheckboxIndicator } from '@ui-sdk/react/checkbox'
import { Check, Minus } from 'lucide-react'

import { cn } from '../../lib/utils'

const Checkbox = React.forwardRef<
  HTMLButtonElement,
  Omit<React.ComponentPropsWithoutRef<typeof UiCheckbox>, 'className' | 'render'> & {
    className?: string
  }
>(({ className, ...props }, ref) => (
  <UiCheckbox
    data-slot="checkbox"
    render={(props, state) => (
      <button
        {...props}
        data-state={state.indeterminate ? 'indeterminate' : state.checked ? 'checked' : 'unchecked'}
      />
    )}
    ref={ref}
    className={cn(
      'grid place-content-center peer h-4 w-4 shrink-0 rounded-sm border border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-action data-[state=checked]:text-action-foreground data-[state=indeterminate]:bg-action data-[state=indeterminate]:text-action-foreground',
      className,
    )}
    {...props}
  >
    <CheckboxIndicator
      render={(props, state) => (
        <span
          {...props}
          data-state={
            state.indeterminate ? 'indeterminate' : state.checked ? 'checked' : 'unchecked'
          }
        />
      )}
      className={cn('group/indicator grid place-content-center text-current')}
    >
      <Check className="h-4 w-4 group-data-[state=indeterminate]/indicator:hidden" />
      <Minus className="hidden h-4 w-4 group-data-[state=indeterminate]/indicator:block" />
    </CheckboxIndicator>
  </UiCheckbox>
))
Checkbox.displayName = 'Checkbox'

export { Checkbox }
