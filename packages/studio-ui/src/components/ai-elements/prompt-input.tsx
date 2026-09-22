// Adapted from Vercel AI Elements (MIT), prompt-input.tsx.
import type { ComponentProps } from 'react'
import { CornerDownLeft, LoaderCircle } from 'lucide-react'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'
import { cn } from '../../lib/utils'
export function PromptInput({ className, ...props }: ComponentProps<'form'>) {
  return (
    <form
      className={cn(
        'w-full overflow-hidden rounded-xl border bg-card shadow-xs focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20',
        className,
      )}
      {...props}
    />
  )
}
export function PromptInputTextarea({
  className,
  onKeyDown,
  ...props
}: ComponentProps<typeof Textarea>) {
  return (
    <Textarea
      className={cn(
        'min-h-16 max-h-48 resize-none rounded-none border-0 bg-transparent px-3 py-3 text-[13px] shadow-none [field-sizing:content] focus-visible:ring-0',
        className,
      )}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (
          event.defaultPrevented ||
          event.key !== 'Enter' ||
          event.shiftKey ||
          event.nativeEvent.isComposing
        )
          return
        event.preventDefault()
        const form = event.currentTarget.form
        if (!form?.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled)
          form?.requestSubmit()
      }}
      {...props}
    />
  )
}
export function PromptInputFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex items-center justify-between gap-1 px-2 pb-2', className)}
      {...props}
    />
  )
}
export function PromptInputTools({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex min-w-0 items-center gap-1', className)} {...props} />
}
export function PromptInputSubmit({
  busy,
  className,
  children,
  ...props
}: ComponentProps<typeof Button> & { busy?: boolean }) {
  return (
    <Button
      type="submit"
      size="icon"
      className={cn('size-7 shrink-0 rounded-lg', className)}
      {...props}
    >
      {children ??
        (busy ? (
          <LoaderCircle className="size-3.5 animate-spin" />
        ) : (
          <CornerDownLeft className="size-3.5" />
        ))}
    </Button>
  )
}
