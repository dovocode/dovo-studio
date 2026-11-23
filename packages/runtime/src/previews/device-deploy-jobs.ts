import { setTimeout as delay } from 'node:timers/promises'
import type { DeviceDeployCommand, DeviceDeployResult, DeviceDeployTarget } from '@dovo/protocol'
import { HttpError } from '../errors.js'

type Start = Extract<DeviceDeployCommand, { action: 'start' }>
type Job = {
  input: Start
  hostId?: string
  controller: AbortController
  signal: AbortSignal
  done: Promise<void>
  result?: DeviceDeployResult
  finishedAt?: number
}

export class DeviceDeployJobs {
  private jobs = new Map<string, Job>()

  async follow(input: Exclude<DeviceDeployCommand, Start>, owner: string) {
    const key = JSON.stringify([owner, input.taskId, input.requestId])
    const job = this.jobs.get(key)
    if (!job) throw new HttpError(404, 'This deployment request is no longer available.')
    if (input.action === 'cancel' && !job.finishedAt) job.controller.abort()
    if (input.action === 'status' && input.waitMs && !job.finishedAt) {
      const timer = new AbortController()
      try {
        await Promise.race([job.done, delay(input.waitMs, undefined, { signal: timer.signal })])
      } finally {
        timer.abort()
      }
    }
    return this.status(job)
  }

  start(
    input: Start,
    owner: string,
    grant: AbortSignal | undefined,
    hostId: string | undefined,
    deploy: (input: DeviceDeployTarget, signal: AbortSignal) => Promise<DeviceDeployResult>,
  ) {
    const key = JSON.stringify([owner, input.taskId, input.requestId])
    const previous = this.jobs.get(key)
    if (previous) {
      const target = previous.input
      if (
        target.id !== input.id ||
        target.revision !== input.revision ||
        target.buildNumber !== input.buildNumber
      )
        throw new HttpError(409, 'This request ID already belongs to a different deployment.')
      return this.status(previous)
    }
    for (const [id, job] of this.jobs)
      if (job.finishedAt !== undefined && Date.now() - job.finishedAt > 60 * 60 * 1000)
        this.jobs.delete(id)
    if (this.jobs.size >= 32)
      throw new HttpError(429, 'Too many recent deployments on this runtime.')
    const controller = new AbortController()
    const signal = grant ? AbortSignal.any([grant, controller.signal]) : controller.signal
    signal.throwIfAborted()
    const job: Job = {
      input,
      hostId,
      controller,
      signal,
      done: Promise.resolve().then(async () => {
        try {
          signal.throwIfAborted()
          job.result = await deploy(input, signal)
        } catch (error) {
          job.result = {
            installed: false,
            launched: false,
            message: signal.aborted
              ? 'Deployment stopped. Check the installed build before retrying.'
              : error instanceof HttpError
                ? error.message
                : 'Device Hub could not complete the iPhone deployment.',
          }
        } finally {
          job.finishedAt = Date.now()
        }
      }),
    }
    this.jobs.set(key, job)
    return this.status(job)
  }

  private status(job: Job) {
    const { requestId, id, revision, buildNumber } = job.input
    return {
      requestId,
      id,
      revision,
      buildNumber,
      status: job.result
        ? job.result.launched
          ? 'succeeded'
          : job.signal.aborted
            ? 'cancelled'
            : 'failed'
        : job.signal.aborted
          ? 'cancelling'
          : 'running',
      ...job.result,
    }
  }

  cancel(filter: (job: Job) => boolean = () => true) {
    for (const job of this.jobs.values()) if (!job.finishedAt && filter(job)) job.controller.abort()
  }
}
