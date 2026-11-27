import {
  pipelineSignal,
  type ForgePipelineComparison,
  type ForgePipelineJob,
  type ForgePipelineStep,
} from '@dovo/protocol'

function uniqueMatch<T>(items: readonly T[], matches: (item: T) => boolean) {
  const matching = items.filter(matches)
  return matching.length === 1 ? matching[0] : undefined
}

export function pipelineComparisonRows({ current, baseline }: ForgePipelineComparison) {
  const failed = (job: ForgePipelineJob) =>
    pipelineSignal(job.status).tone === 'danger' || !!job.errors?.length
  return current.jobs
    .map((job) => {
      const previous =
        uniqueMatch(current.jobs, (item) => item.name === job.name) &&
        uniqueMatch(baseline?.jobs ?? [], (item) => item.name === job.name)
      const step = job.steps?.find((item) => pipelineSignal(item.status).tone === 'danger')
      const previousStep =
        step && uniqueMatch(previous?.steps ?? [], (item) => item.name === step.name)
      return { job, previous, step, previousStep, failed: failed(job) }
    })
    .sort((a, b) => Number(b.failed) - Number(a.failed))
}

export function pipelineComparisonLog(job: ForgePipelineJob, step?: ForgePipelineStep) {
  if (step?.url) return step.url
  if (step?.number === undefined || !/\/job\/\d+\/?$/.test(new URL(job.url).pathname))
    return job.url
  const url = new URL(job.url)
  url.hash = `step:${step.number}:1`
  return url.href
}
