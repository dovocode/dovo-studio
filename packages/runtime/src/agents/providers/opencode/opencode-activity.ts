import { setTimeout as delay } from 'node:timers/promises'
import type { OpenCodeClient } from '@opencode/client'
import { ownedJobSessions } from './opencode-job-preview.js'

/** A failed status read does not confirm that a remote session stopped. */
export async function waitForOpenCodeIdle(check: () => Promise<boolean>, signal: AbortSignal) {
  for (let interval = 250; ; interval = Math.min(interval * 2, 30000)) {
    signal.throwIfAborted()
    const idle = await check().catch(() => false)
    signal.throwIfAborted()
    if (idle) return
    await delay(interval, undefined, { signal, ref: false })
  }
}

export async function openCodeV2ActiveWork(
  api: OpenCodeClient,
  sessionID: string,
  includeJobs: boolean,
  signal: AbortSignal,
) {
  const active = new Set(Object.keys(await api.session.active({ signal })))
  if (includeJobs) {
    const jobs = await api.experimental.job.list({ sessionID, descendants: true }, { signal })
    const owned = ownedJobSessions(jobs, sessionID)
    if ([...owned].some((id) => active.has(id))) active.add(sessionID)
    for (const job of jobs) {
      if (job.status !== 'running' || !owned.has(job.sessionID)) continue
      active.add(sessionID)
      active.add(`job:${job.id}`)
    }
  }
  return active
}
