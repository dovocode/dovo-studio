import { contextMeter } from '@dovo/protocol'
import type { Task } from '@dovo/studio-core'
import { cn } from '@dovo/studio-ui'

/** A small ring showing how full the agent's context window is. */
export function ContextMeter({ task }: { task: Task }) {
  const meter = contextMeter(task)
  if (!meter) return null
  const radius = 6
  const circumference = 2 * Math.PI * radius
  const tone =
    meter.level === 'full'
      ? 'text-destructive'
      : meter.level === 'warn'
        ? 'text-amber-400'
        : 'text-muted-foreground'
  return (
    <span
      role="meter"
      aria-label="Agent context used"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={meter.percent}
      aria-valuetext={meter.label}
      title={meter.label}
      className={cn('inline-flex items-center gap-1 text-[0.625rem] tabular-nums', tone)}
    >
      {meter.percent !== undefined && (
        <svg viewBox="0 0 16 16" className="size-3.5 -rotate-90" aria-hidden>
          <circle
            cx="8"
            cy="8"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.2}
            strokeWidth={2}
          />
          <circle
            cx="8"
            cy="8"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - meter.percent / 100)}
          />
        </svg>
      )}
      {meter.short}
    </span>
  )
}
