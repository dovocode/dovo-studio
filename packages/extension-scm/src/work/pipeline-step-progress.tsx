import { pipelineSignal, type ForgePipelineJob } from '@dovo/protocol'

/** Each block represents one reported step, including skipped and unknown steps. */
export function PipelineStepProgress({ job }: { job: ForgePipelineJob }) {
  const steps = job.steps
  if (!steps?.length)
    return <span className="block text-[10px] text-muted-foreground">Steps not reported</span>
  const completed = steps.filter((step) => pipelineSignal(step.status).phase === 'finished').length
  return (
    <span
      className="block w-full min-w-0 space-y-1.5"
      role="group"
      aria-label={`${job.name} step progress`}
    >
      <span className="block text-[10px] tabular-nums text-muted-foreground">
        {completed}/{steps.length} steps complete
      </span>
      <span className="flex flex-wrap gap-1">
        {steps.map((step) => {
          const signal = pipelineSignal(step.status)
          const color = {
            success: 'bg-status-success',
            danger: 'bg-destructive',
            warning: 'bg-status-warning',
            info: 'bg-primary',
            neutral: 'bg-muted-foreground/25',
          }[signal.tone]
          return (
            <span
              key={step.id}
              role="img"
              aria-label={`${step.name}: ${signal.label}`}
              title={`${step.name} · ${signal.label}`}
              className={`h-1.5 min-w-2 flex-1 rounded-sm ${color}`}
            />
          )
        })}
      </span>
    </span>
  )
}
