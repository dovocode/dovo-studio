import { contextMeter, type Task } from '@dovo/protocol'

export function ThreadInfoUsage({ task }: { task: Task }) {
  const meter = contextMeter(task)
  const usage = task.contextUsage
  return (
    <section
      aria-label="Context usage"
      className="studio-project-section border-t border-border/60"
    >
      <div className="flex items-center justify-between gap-3 text-xs">
        <h3 className="font-medium text-muted-foreground">Context</h3>
        <span className="tabular-nums">
          {meter
            ? `${meter.short}${meter.percent !== undefined ? ' used' : ' tokens'}`
            : 'Not reported'}
        </span>
      </div>
      {meter?.percent !== undefined && (
        <div
          role="meter"
          aria-label="Agent context used"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={meter.percent}
          aria-valuetext={meter.label}
          title={meter.label}
          className="mt-2 h-1 overflow-hidden rounded-full bg-muted"
        >
          <div
            className={
              meter.level === 'full'
                ? 'h-full bg-destructive'
                : meter.level === 'warn'
                  ? 'h-full bg-status-warning'
                  : 'h-full bg-muted-foreground'
            }
            style={{ width: `${meter.percent}%` }}
          />
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        {usage?.used !== undefined
          ? `${usage.used.toLocaleString()}${usage.limit ? ` of ${usage.limit.toLocaleString()}` : ''} tokens in this session${usage.limit ? '.' : ' · Window size not reported.'}`
          : 'Available after the provider reports context usage.'}
      </p>
    </section>
  )
}
