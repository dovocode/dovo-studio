import { CheckCircle2, CircleDot, Clock3, XCircle } from 'lucide-react'
import { pipelineSignal } from '@dovo/protocol'

export function PipelineState({ status }: { status: string }) {
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
    success: 'bg-status-success/10 text-status-success',
    danger: 'bg-destructive/10 text-destructive',
    warning: 'bg-status-warning/10 text-status-warning',
    info: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
    neutral: 'bg-muted text-muted-foreground',
  }[signal.tone]
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium leading-none ${color}`}
    >
      <Icon className="size-3.5" />
      {signal.label}
    </span>
  )
}
