import { composerPlanLimit, formatQuotaReset } from '@dovo/protocol'
import { useWorkspace, type Task } from '@dovo/studio-core'
/** Snapshot-driven; no polling, probes or composer state updates while typing. */
export function PlanLimit({ task }: { task: Task }) {
  const { workspace, connected } = useWorkspace()
  const reading = composerPlanLimit(task, workspace.planLimits ?? [], connected)
  if (!reading) return null
  return (
    <span
      title={`${reading.label} · ${formatQuotaReset(reading.limit.resetsAt)} · Account quota, separate from context usage`}
      className={`text-[0.625rem] tabular-nums ${reading.state === 'fresh' && reading.remaining <= 10 ? 'text-amber-400' : 'text-muted-foreground'}`}
    >
      {reading.state === 'fresh'
        ? `${reading.remaining}% quota`
        : `Quota ${reading.state === 'awaiting' ? 'pending' : reading.state}`}
    </span>
  )
}
