import { ownedJobSessions, readOpencodeJob } from './opencode-job-preview.js'
import type { JobInfo, OpenCodeClient } from '@opencode/client'
import { setTimeout as delay } from 'node:timers/promises'
import type { AgentRun } from '../../execution/types.js'
import { OwnedProcessShutdownError } from '../../execution/stop-owned-child.js'

type Job = Exclude<JobInfo, { kind: 'subagent' }>
type Tracked = { info: Job; output: string; cursor: number }

/** Inventory is session-filtered by the server and checked again before use. */
export function opencodeJobs(
  run: AgentRun,
  api: OpenCodeClient,
  sessionID: string,
  owns: (id: string) => boolean,
) {
  const jobs = new Map<string, Tracked>()
  let revision = 0
  let enabled = false
  let refreshing: Promise<void> | undefined
  const options = () => ({ signal: AbortSignal.any([run.signal, AbortSignal.timeout(5000)]) })
  const publish = (job: Tracked) =>
    run.onSubagentEvent?.(
      'dovo/opencode/job',
      {
        id: `job:${job.info.id}`,
        name: job.info.title ?? (job.info.kind === 'shell' ? job.info.command : 'Image generation'),
        status: job.info.status,
        result: job.output,
        model: job.info.kind === 'image' ? job.info.model : undefined,
        canStopIndividual: job.info.kind === 'shell',
      },
      sessionID,
    )
  const refresh = () => {
    if (!enabled) return Promise.resolve()
    if (refreshing) return refreshing
    refreshing = (async () => {
      const before = revision
      const inventory = await api.experimental.job.list({ sessionID, descendants: true }, options())
      const owned = ownedJobSessions(inventory, sessionID)
      for (const info of inventory) {
        if (
          info.kind === 'subagent' ||
          (info.sessionID !== sessionID && !owns(info.sessionID) && !owned.has(info.sessionID))
        )
          continue
        const previous = jobs.get(info.id)
        // Terminal jobs do not need repeated output reads or state writes.
        if (previous && previous.info.status !== 'running') continue
        if (!previous && jobs.size >= 100)
          throw new Error('OpenCode job inventory exceeds the 100-job limit.')
        const job: Tracked = { info, output: previous?.output ?? '', cursor: previous?.cursor ?? 0 }
        if (info.kind === 'shell') {
          const shell = await api.shell.get(
            { id: info.shellID, location: { directory: run.cwd } },
            options(),
          )
          // The final read starts near the tail, so large output cannot hide the exit diagnostic.
          const output = await api.shell.output(
            {
              id: info.shellID,
              location: { directory: run.cwd },
              cursor: job.cursor,
              limit: 64000,
            },
            options(),
          )
          const tail =
            info.status !== 'running' && output.data.size > output.data.cursor
              ? await api.shell.output(
                  {
                    id: info.shellID,
                    location: { directory: run.cwd },
                    cursor: Math.max(0, output.data.size - 64000),
                    limit: 64000,
                  },
                  options(),
                )
              : output
          job.cursor = tail.data.cursor
          job.output = (job.output + tail.data.output).slice(-64000)
          if (shell.data.status !== 'running') {
            job.info = {
              ...info,
              status:
                shell.data.status === 'killed'
                  ? 'cancelled'
                  : shell.data.status === 'timeout' || shell.data.exit !== 0
                    ? 'error'
                    : 'completed',
            }
            job.output = `${job.output}\nExit: ${shell.data.exit ?? shell.data.status}`.slice(
              -64000,
            )
          }
        } else job.output = `Image generation ${info.status}. Output: ${info.path}`
        if (before !== revision) continue
        jobs.set(info.id, job)
        if (!previous || JSON.stringify(previous) !== JSON.stringify(job)) publish(job)
      }
    })().finally(() => {
      refreshing = undefined
    })
    return refreshing
  }
  return {
    async initialize(supported: boolean) {
      enabled = supported
      await refresh()
    },
    refresh,
    owns(id: string) {
      return id.startsWith('job:') && jobs.has(id.slice(4))
    },
    async read(id: string) {
      const job = id.startsWith('job:') ? jobs.get(id.slice(4)) : undefined
      if (!job) throw new Error('This job does not belong to the OpenCode session.')
      return job.info.kind === 'image'
        ? readOpencodeJob(run.agent, id, sessionID, run.cwd)
        : [{ id, role: 'tool' as const, text: job.output, label: job.info.command }]
    },
    async stop(id?: string) {
      // Stop uses its own deadline because the turn's signal may already be cancelled.
      revision++
      if (id && !this.owns(id)) throw new Error('This job does not belong to the OpenCode session.')
      const selected = [...jobs.values()].filter(
        (job) => job.info.status === 'running' && (!id || `job:${job.info.id}` === id),
      )
      for (const job of selected) {
        if (job.info.kind === 'shell') {
          await api.shell.remove(
            { id: job.info.shellID, location: { directory: run.cwd } },
            { signal: AbortSignal.timeout(5000) },
          )
          const inventory = await api.experimental.job.list(
            { sessionID: job.info.sessionID, kind: 'shell' },
            { signal: AbortSignal.timeout(5000) },
          )
          if (inventory.some((item) => item.id === job.info.id && item.status === 'running'))
            throw new OwnedProcessShutdownError('OpenCode shell shutdown was not confirmed.')
          job.info = { ...job.info, status: 'cancelled' }
          publish(job)
        } else {
          await api.session.interrupt(
            { sessionID: job.info.sessionID },
            { signal: AbortSignal.timeout(5000) },
          )
          const inventory = await api.experimental.job.list(
            { sessionID: job.info.sessionID, kind: 'image' },
            { signal: AbortSignal.timeout(5000) },
          )
          const current = inventory.find((item) => item.id === job.info.id)
          if (!current || current.status === 'running')
            throw new OwnedProcessShutdownError(
              'OpenCode image job shutdown was not confirmed. Review it before continuing.',
            )
          job.info = { ...job.info, status: current.status }
          publish(job)
        }
      }
    },
    async drain(stream: Promise<unknown>) {
      await refresh()
      while ([...jobs.values()].some((job) => job.info.status === 'running')) {
        run.onActivity('Waiting for native background jobs')
        await Promise.race([
          delay(1000, undefined, { signal: run.signal }),
          stream.then(() => {
            throw new Error('OpenCode stream closed with pending background jobs.')
          }),
        ])
        await refresh()
      }
    },
  }
}
