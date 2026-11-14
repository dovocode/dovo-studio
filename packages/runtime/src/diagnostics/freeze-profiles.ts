import { Session } from 'node:inspector/promises'
import type { Profiler } from 'node:inspector'
import { fileURLToPath } from 'node:url'

export type FreezeProfile = {
  at: string
  durationMs: number
  samples: number
  functions: { name: string; samples: number }[]
}
const runtimeRoot = fileURLToPath(new URL('../', import.meta.url))
let profiling = false

/** Keep runtime function names only. Never retain source URLs, script text or user function names. */
export function summarizeCpuProfile(profile: Profiler.Profile): FreezeProfile {
  const names = new Map(
    profile.nodes.map((node) => {
      const frame = node.callFrame
      let url = frame.url
      try {
        if (url.startsWith('file:')) url = fileURLToPath(url)
      } catch {
        url = ''
      }
      const runtime = url.startsWith(runtimeRoot)
      const name =
        runtime && /^[\w$.<> -]{1,80}$/.test(frame.functionName)
          ? frame.functionName
          : url.startsWith('node:')
            ? '[node]'
            : '[other JavaScript]'
      return [node.id, name] as const
    }),
  )
  const counts = new Map<string, number>()
  for (const id of profile.samples ?? []) {
    const name = names.get(id) ?? '[unknown]'
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return {
    at: new Date().toISOString(),
    durationMs: (profile.endTime - profile.startTime) / 1000,
    samples: profile.samples?.length ?? 0,
    functions: [...counts]
      .map(([name, samples]) => ({ name, samples }))
      .sort((a, b) => b.samples - a.samples)
      .slice(0, 10),
  }
}

export async function captureFreezeProfile(signal: AbortSignal) {
  const session = new Session()
  session.connect()
  try {
    await session.post('Profiler.enable')
    await session.post('Profiler.setSamplingInterval', { interval: 1000 })
    await session.post('Profiler.start')
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', finish)
        resolve()
      }
      const timer = setTimeout(finish, 2000)
      timer.unref()
      signal.addEventListener('abort', finish, { once: true })
      if (signal.aborted) finish()
    })
    const { profile } = await session.post('Profiler.stop')
    return summarizeCpuProfile(profile)
  } finally {
    session.disconnect()
  }
}

/** Opt-in sampling after two busy event-loop stalls. At most one two-second profile per ten minutes. */
export class FreezeProfiles {
  private stalls: number[] = []
  private reports: FreezeProfile[] = []
  private cooldown = 0
  private controller = new AbortController()
  private error: string | undefined
  constructor(
    private enabled: () => boolean,
    private collect = captureFreezeProfile,
    private now = Date.now,
  ) {}
  sample(lagMs: number, busy: number) {
    if (!this.enabled() || this.controller.signal.aborted) {
      this.stalls = []
      return
    }
    const now = this.now()
    this.stalls = this.stalls.filter((at) => now - at < 60_000)
    if (lagMs < 500 || busy < 0.8) return
    this.stalls.push(now)
    if (this.stalls.length < 2 || now < this.cooldown || profiling) return
    this.cooldown = now + 600_000
    this.stalls = []
    profiling = true
    void this.collect(this.controller.signal)
      .then(
        (report) => {
          if (this.controller.signal.aborted || !this.enabled()) return
          this.error = undefined
          this.reports = [...this.reports.slice(-2), report]
        },
        () => {
          this.error = 'CPU profiling is unavailable in this runtime.'
        },
      )
      .finally(() => {
        profiling = false
      })
  }
  snapshot() {
    return { enabled: this.enabled(), error: this.error, profiles: [...this.reports] }
  }
  dispose() {
    this.controller.abort()
    this.reports = []
    this.stalls = []
  }
}
