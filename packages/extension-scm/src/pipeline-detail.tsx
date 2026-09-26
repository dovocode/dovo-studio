import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  ExternalLink,
  GitBranch,
  XCircle,
} from 'lucide-react'
import {
  pipelineDuration,
  pipelineSignal,
  type ForgePipelineDetail,
  type ForgePipelineJob,
  formatDateTime,
} from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'
import { WorkTaskLinks } from './work-task-links'
export function PipelineDetail({
  detail,
  notice,
  repositoryId,
  disabled,
  loading,
  onMore,
}: {
  detail: ForgePipelineDetail
  notice?: string
  repositoryId: string
  disabled: boolean
  loading: boolean
  onMore: () => void
}) {
  const { run, jobs } = detail
  const [now, setNow] = useApplicationState(Date.now)
  const active = pipelineSignal(run.status).phase === 'active'
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active, run.id])
  const duration = pipelineDuration(run, now)
  const orderedJobs = [...jobs].sort(
    (left, right) =>
      Number(pipelineSignal(right.status).tone === 'danger' || !!right.errors?.length) -
      Number(pipelineSignal(left.status).tone === 'danger' || !!left.errors?.length),
  )
  const failedJobs = orderedJobs.filter(
    (job) => pipelineSignal(job.status).tone === 'danger' || !!job.errors?.length,
  ).length
  const metadata = [
    ['Workflow', run.workflow || run.definition],
    ['Branch', run.ref],
    ['Triggered by', run.actor],
    ['Trigger', run.event?.replace(/_/g, ' ')],
    ['Attempt', run.attempt?.toString()],
    ['Created', formatPipelineDate(run.createdAt)],
    ['Updated', formatPipelineDate(run.updatedAt)],
    ['Started', formatPipelineDate(run.startedAt)],
    ['Finished', formatPipelineDate(run.completedAt)],
    [active ? 'Elapsed' : 'Duration', duration],
  ]
  return (
    <article className="mx-auto max-w-4xl space-y-5" aria-label="Pipeline details">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <PipelineState status={run.status} />
          <span className="text-xs text-muted-foreground">Run {run.number || run.id}</span>
          <a
            href={run.url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1.5 rounded py-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Open run and logs <ExternalLink className="size-3.5 shrink-0" />
          </a>
        </div>
        <h2 className="break-words text-xl font-semibold">{run.title}</h2>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          {run.ref && (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <GitBranch className="size-3.5 shrink-0" />
              <span className="break-all">{run.ref}</span>
            </span>
          )}
          {duration && (
            <span className="tabular-nums">
              {active ? 'Running for ' : ''}
              {duration}
            </span>
          )}
          {run.actor && <span>Triggered by {run.actor}</span>}
          {run.sha && (
            <span className="font-mono" title={run.sha}>
              {run.sha.slice(0, 8)}
            </span>
          )}
        </div>
      </header>
      <WorkTaskLinks key={run.url} repositoryId={repositoryId} source={run} disabled={disabled} />
      {notice && (
        <p role="status" className="text-xs text-muted-foreground">
          {notice}
        </p>
      )}
      <PipelineErrors errors={run.errors} />
      <section aria-label="Pipeline jobs" className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-sm font-medium">
            {failedJobs ? `${failedJobs} failed ${failedJobs === 1 ? 'job' : 'jobs'}` : 'Jobs'}
          </h3>
          <span className="text-xs text-muted-foreground">
            {jobs.length}
            {detail.next ? '+' : ''} {jobs.length === 1 && !detail.next ? 'job' : 'jobs'}
          </span>
        </div>
        <div className="divide-y overflow-hidden rounded-lg border">
          {orderedJobs.map((job) => (
            <PipelineJob key={job.id} job={job} now={now} />
          ))}
          {!jobs.length && (
            <p className="p-4 text-sm text-muted-foreground">
              {active
                ? 'Jobs will appear when the runner reports them. Refresh to check for updates.'
                : 'No jobs were returned for this run.'}
            </p>
          )}
        </div>
        {detail.next && (
          <Button disabled={loading} variant="outline" size="sm" onClick={onMore}>
            More jobs
          </Button>
        )}
      </section>
      <details className="border-t pt-3">
        <summary className="cursor-pointer py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
          Run details
        </summary>
        {run.commitMessage && (
          <p className="my-3 whitespace-pre-wrap break-words text-sm text-muted-foreground">
            {run.commitMessage}
          </p>
        )}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 py-3 sm:grid-cols-3">
          {metadata.map(([label, value]) =>
            value ? (
              <div key={label} className="min-w-0 space-y-1">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="break-words text-sm">{value}</dd>
              </div>
            ) : null,
          )}
          {run.sha && (
            <div className="col-span-full min-w-0 space-y-1">
              <dt className="text-xs text-muted-foreground">Commit</dt>
              <dd className="break-all font-mono text-xs select-text">{run.sha}</dd>
            </div>
          )}
        </dl>
      </details>
    </article>
  )
}
function PipelineJob({ job, now }: { job: ForgePipelineJob; now: number }) {
  const failed = pipelineSignal(job.status).tone === 'danger' || !!job.errors?.length
  const [expanded, setExpanded] = useApplicationState(failed)
  useEffect(() => {
    if (failed) setExpanded(true)
  }, [failed])
  const duration = pipelineDuration(job, now)
  return (
    <section aria-label={`Job ${job.name}`}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full min-w-0 items-center gap-3 p-3 text-left hover:bg-muted/40"
      >
        <ChevronDown
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? '' : '-rotate-90'}`}
        />
        <span className="min-w-0 flex-1 break-words text-sm font-medium">{job.name}</span>
        <span className="flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {duration && (
            <span className="text-xs tabular-nums text-muted-foreground">{duration}</span>
          )}
          <PipelineState status={job.status} />
        </span>
      </button>
      {expanded && (
        <div className="space-y-3 border-t bg-muted/10 p-3 sm:pl-10">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            {job.runner && <span className="min-w-0 break-words">Runner · {job.runner}</span>}
            {job.startedAt && <span>Started {formatPipelineDate(job.startedAt)}</span>}
            {job.completedAt && <span>Finished {formatPipelineDate(job.completedAt)}</span>}
            <a
              href={job.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 underline underline-offset-4"
            >
              Open job logs <ExternalLink className="size-3 shrink-0" />
            </a>
          </div>
          <PipelineErrors errors={job.errors} />
          {job.steps?.length ? (
            <ol aria-label={`${job.name} steps`} className="divide-y">
              {job.steps.map((step) => (
                <li key={step.id} className="space-y-2 py-2.5">
                  <div className="flex min-w-0 items-start gap-3">
                    {step.number !== undefined && (
                      <span className="w-4 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                        {step.number}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 break-words text-sm">{step.name}</span>
                    <span className="flex shrink-0 flex-wrap justify-end gap-x-3 gap-y-1">
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {pipelineDuration(step, now)}
                      </span>
                      <PipelineState status={step.status} />
                    </span>
                  </div>
                  <PipelineErrors errors={step.errors} />
                  {step.url && (
                    <a
                      href={step.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground underline"
                    >
                      Open step logs <ExternalLink className="size-3" />
                    </a>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-xs text-muted-foreground">
              Step details were not provided for this job. Open its logs for the full output.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
function PipelineErrors({ errors }: { errors?: string[] }) {
  return errors?.length ? (
    <div
      className="space-y-2 rounded-md border border-destructive/20 bg-destructive/5 p-3"
      aria-label="Reported errors"
    >
      {errors.map((message, index) => (
        <p
          key={`${index}:${message}`}
          className="whitespace-pre-wrap break-words text-xs text-destructive"
        >
          {message}
        </p>
      ))}
    </div>
  ) : null
}
function formatPipelineDate(value?: string) {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : formatDateTime(date, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
}
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
    success: 'text-emerald-500',
    danger: 'text-destructive',
    warning: 'text-amber-500',
    info: 'text-blue-500',
    neutral: 'text-muted-foreground',
  }[signal.tone]
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 text-xs ${color}`}>
      <Icon className="size-3.5" />
      {signal.label}
    </span>
  )
}
