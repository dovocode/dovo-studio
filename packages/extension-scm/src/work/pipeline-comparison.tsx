import { useInterfaceText } from '@dovo/studio-core/interface-language'
import {
  pipelineComparisonLog,
  pipelineComparisonRows,
} from '@dovo/studio-core/pipeline-comparison'
import { useComparison } from '@dovo/studio-core/comparison'
import type { ForgePipelineComparison } from '@dovo/protocol'
import { Button } from '@dovo/studio-ui'
import { PipelineState } from './pipeline-state'

export function PipelineComparison({
  load,
  connected,
}: {
  load: () => Promise<ForgePipelineComparison>
  connected: boolean
}) {
  const text = useInterfaceText()
  const { state, open, close } = useComparison(load)
  if (state.status === 'closed')
    return (
      <Button variant="outline" size="sm" disabled={!connected} onClick={() => void open()}>
        {text('Compare with last success')}
      </Button>
    )
  const comparison = state.status === 'ready' ? state.value : undefined
  return (
    <section
      aria-label={text('Compare with last success')}
      className="space-y-3 rounded-xl border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{text('Compare with last success')}</h3>
        <Button variant="outline" size="sm" onClick={close}>
          {text('Close comparison')}
        </Button>
      </div>
      {state.status === 'loading' && <p role="status">{text('Loading comparison…')}</p>}
      {state.status === 'failed' && (
        <>
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
          <Button variant="outline" size="sm" disabled={!connected} onClick={() => void open()}>
            {text('Retry')}
          </Button>
        </>
      )}
      {comparison && !comparison.baseline && (
        <p role="status">{text('No earlier successful run for this workflow and branch.')}</p>
      )}
      {comparison?.baseline && (
        <>
          <div className="flex flex-wrap gap-3 text-sm">
            {[comparison.current.run, comparison.baseline.run].map((run) => (
              <a
                key={run.id}
                href={run.url}
                data-dovo-external
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                {text('Run {value0} · Attempt {value1}', {
                  value0: run.number || run.id,
                  value1: run.attempt ?? 1,
                })}
              </a>
            ))}
          </div>
          <ul className="divide-y text-sm">
            {pipelineComparisonRows(comparison).map(({ job, previous, step, previousStep }) => (
              <li key={job.id} className="grid gap-2 py-2 sm:grid-cols-2">
                <div>
                  <p className="font-medium">
                    {job.name} <PipelineState status={job.status} />
                  </p>
                  <a
                    href={pipelineComparisonLog(job, step)}
                    data-dovo-external
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {step?.name ?? text('Open job logs')}
                  </a>
                </div>
                {previous ? (
                  <div>
                    <PipelineState status={previousStep?.status ?? previous.status} />{' '}
                    <a
                      href={pipelineComparisonLog(previous, previousStep)}
                      data-dovo-external
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      {previousStep?.name ?? text('Open previous job logs')}
                    </a>
                  </div>
                ) : (
                  <span className="text-muted-foreground">
                    {text('No matching job in the successful run.')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
