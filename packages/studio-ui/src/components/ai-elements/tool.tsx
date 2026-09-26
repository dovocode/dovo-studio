// Adapted from Vercel AI Elements (MIT), tool.tsx. Status names follow the local runtime.
import type { ComponentProps } from 'react'
import { CheckCircle2, ChevronDown, Circle, Clock3, Wrench, XCircle } from 'lucide-react'
import { cn } from '../../lib/utils'
export function Tool({ className, ...props }: ComponentProps<'details'>) {
  return (
    <details
      className={cn('group/tool not-prose w-full rounded-md border', className)}
      {...props}
    />
  )
}
export function ToolHeader({ title, status }: { title: string; status: string }) {
  const completed = status === 'completed',
    failed = status === 'failed' || status === 'error',
    running = status === 'running'
  const Icon = completed ? CheckCircle2 : failed ? XCircle : running ? Clock3 : Circle
  return (
    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2">
      <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-xs font-medium" title={title}>
        {title}
      </span>
      <span className="flex shrink-0 items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[0.625rem] capitalize text-muted-foreground">
        <Icon
          className={cn(
            'size-3',
            completed && 'text-emerald-400',
            failed && 'text-destructive',
            running && 'animate-pulse',
          )}
        />
        {status}
      </span>
      <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/tool:rotate-180" />
    </summary>
  )
}
export function ToolContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('space-y-2 border-t p-3 text-xs', className)} {...props} />
}
