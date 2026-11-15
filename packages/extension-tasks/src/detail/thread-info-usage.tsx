import { contextMeter, type Task } from '@dovo/protocol'

export function ThreadInfoUsage({ task, detailed = true }: { task: Task; detailed?: boolean }) {
  const meter = contextMeter(task)
  if (!meter) return null
  return (
    <section
      aria-label="Context usage"
      className="studio-project-section border-t border-border/60"
    >
      <div className="flex items-center justify-between gap-3 text-xs" title={meter.label}>
        <h3 className="font-medium text-muted-foreground">Context</h3>
        <span className="text-xs font-medium tabular-nums">
          {`${meter.short}${meter.percent !== undefined ? ' used' : ' tokens'}`}
        </span>
      </div>
      {meter.percent !== undefined && (
        <div
          role="meter"
          aria-label="Agent context used"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={meter.percent}
          aria-valuetext={meter.label}
          title={meter.label}
          className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted"
        >
          <div
            className={
              meter.level === 'full'
                ? 'h-full bg-destructive'
                : meter.level === 'warn'
                  ? 'h-full bg-status-warning'
                  : 'h-full bg-primary'
            }
            style={{ width: `${meter.percent}%` }}
          />
        </div>
      )}
      {detailed && task.contextUsage?.used !== undefined && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground tabular-nums">
          {task.contextUsage.used.toLocaleString()}
          {task.contextUsage.limit ? ` / ${task.contextUsage.limit.toLocaleString()}` : ''} tokens
        </p>
      )}
    </section>
  )
}
