import { CheckCircle2, CircleDot, Clock3, XCircle } from 'lucide-react'
import { pipelineSignal } from '@dovo/protocol'

export function PipelineState({ status, plain = false }: { status: string; plain?: boolean }) {
  const signal = pipelineSignal(status)
  const Icon =
    signal.tone === 'success'
      ? CheckCircle2
      : signal.tone === 'danger'
        ? XCircle
        : signal.phase === 'active'
          ? Clock3
          : CircleDot
  const color = {
    success: 'text-status-success',
    danger: 'text-destructive',
    warning: 'text-status-warning',
    info: 'text-blue-700 dark:text-blue-400',
    neutral: 'text-muted-foreground',
  }[signal.tone]
  const background = {
    success: 'bg-status-success/10',
    danger: 'bg-destructive/10',
    warning: 'bg-status-warning/10',
    info: 'bg-blue-500/10',
    neutral: 'bg-muted',
  }[signal.tone]
  return (
    <span
      className={
        plain
          ? `studio-collection-status ${color}`
          : `inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium leading-none ${color} ${background}`
      }
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate" title={signal.label}>
        {signal.label}
      </span>
    </span>
  )
}
