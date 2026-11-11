'use client'

import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'

import { useNativeTooltipContainer } from '../../native-tooltip'

import { cn } from '../../lib/utils'

const TooltipProvider = TooltipPrimitive.Provider

const OpenContext = React.createContext({ open: false, close: () => {} })
function Tooltip({
  open: controlled,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const [value, setValue] = React.useState(defaultOpen ?? false)
  const open = controlled ?? value
  const close = React.useCallback(() => {
    setValue(false)
    onOpenChange?.(false)
  }, [onOpenChange])
  return (
    <OpenContext.Provider value={{ open, close }}>
      <TooltipPrimitive.Root
        {...props}
        open={open}
        onOpenChange={(next) => {
          setValue(next)
          onOpenChange?.(next)
        }}
      />
    </OpenContext.Provider>
  )
}

const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => {
  const context = React.useContext(OpenContext)
  const native = useNativeTooltipContainer(context.open, context.close)
  if (native.enabled && !native.container) return null
  return (
    <TooltipPrimitive.Portal container={native.container}>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          'studio-tooltip studio-menu-surface z-50 overflow-hidden rounded-full border border-border/70 bg-[var(--studio-floating-fill)] px-3 py-1.5 text-xs text-popover-foreground',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  )
})
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
