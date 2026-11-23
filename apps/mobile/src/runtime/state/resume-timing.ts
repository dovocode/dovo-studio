type Milestone = 'composer-ready' | 'fresh-snapshot'
let resume: { startedAt: number; pending: Set<Milestone> } | undefined

export function beginMobileResumeTiming() {
  resume = { startedAt: performance.now(), pending: new Set(['composer-ready', 'fresh-snapshot']) }
}

export function cancelMobileResumeTiming() {
  resume = undefined
}

export function markMobileResume(milestone: Milestone, transport?: 'http' | 'websocket') {
  if (!resume?.pending.delete(milestone)) return
  const durationMs = Math.round(performance.now() - resume.startedAt)
  if (durationMs <= 60_000)
    console.log('[dovo mobile resume]', { milestone, durationMs, ...(transport && { transport }) })
  if (!resume.pending.size || durationMs > 60_000) resume = undefined
}
