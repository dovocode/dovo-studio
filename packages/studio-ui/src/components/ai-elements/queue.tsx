// Adapted from Vercel AI Elements (MIT), queue.tsx. Native disclosure keeps the source compact.
import type { ComponentProps } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../lib/utils'
export function Queue({ className, ...props }: ComponentProps<'details'>) {
  return (
    <details
      className={cn(
        'group/queue flex flex-col rounded-xl border bg-background p-2 shadow-xs',
        className,
      )}
      {...props}
    />
  )
}
export function QueueSectionTrigger({ className, children, ...props }: ComponentProps<'summary'>) {
  return (
    <summary
      className={cn(
        'flex cursor-pointer list-none items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted',
        className,
      )}
      {...props}
    >
      <ChevronDown className="size-3.5 -rotate-90 transition-transform group-open/queue:rotate-0" />
      {children}
    </summary>
  )
}
export function QueueList({ className, ...props }: ComponentProps<'ol'>) {
  return <ol className={cn('mt-1 max-h-36 overflow-auto', className)} {...props} />
}
export function QueueItem({ className, ...props }: ComponentProps<'li'>) {
  return (
    <li
      className={cn(
        'group flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors hover:bg-muted',
        className,
      )}
      {...props}
    />
  )
}
export function QueueItemIndicator() {
  return <span className="size-2 shrink-0 rounded-full border border-muted-foreground/50" />
}
export function QueueItemContent({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span className={cn('min-w-0 flex-1 truncate text-muted-foreground', className)} {...props} />
  )
}
