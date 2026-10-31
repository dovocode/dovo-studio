import { readdir, readFile } from 'node:fs/promises'
import { getHeapStatistics } from 'node:v8'
import { performance, PerformanceObserver } from 'node:perf_hooks'
import type { RuntimeMemoryDiagnostics } from '@dovo/protocol'

const MB = 1024 * 1024
// Smaller growth is noise from concurrent requests and agent output; recording it would
// evict the operations worth naming.
const OPERATION_GROWTH_BYTES = 8 * MB
const OPERATION_SLOW_MS = 1_000
const RECENT_OPERATIONS = 32
const OPEN_OPERATIONS = 256
const SPIKE_GROWTH_BYTES = 128 * MB
const SPIKE_WINDOW_MS = 10_000
const SPIKE_COOLDOWN_MS = 60_000
const SPIKE_REPORTS = 5
const REPORTED_SUSPECTS = 8
const SAMPLE_INTERVAL_MS = 1_000
const IDLE_SAMPLE_INTERVAL_MS = 10_000
const MAX_CHILD_PROCESSES = 512

type Operation = { name: string; startHeap: number; startedAt: number }
type Finished = RuntimeMemoryDiagnostics['recent'][number] & { ended: number }
export type MemoryReadings = {
  heapUsed: () => number
  heapLimit: () => number
  external: () => number
  arrayBuffers: () => number
  rss: () => number
  now: () => number
}
const processReadings: MemoryReadings = {
  heapUsed: () => getHeapStatistics().used_heap_size,
  heapLimit: () => getHeapStatistics().heap_size_limit,
  external: () => getHeapStatistics().external_memory,
  arrayBuffers: () => process.memoryUsage().arrayBuffers,
  rss: () => process.memoryUsage.rss(),
  now: () => Date.now(),
}

/**
 * Bounded heap attribution for the runtime process. Heap growth includes concurrent work and
 * garbage-collection timing, so a spike report names suspects, never a proven culprit.
 */
export class MemoryAttribution {
  private open = new Map<symbol, Operation>()
  private recent: Finished[] = []
  private spikes: RuntimeMemoryDiagnostics['spikes'] = []
  private samples: { at: number; heap: number; external: number }[] = []
  private cooldownUntil = 0
  private timer?: ReturnType<typeof setTimeout>
  private timerAt?: number
  private intervalMs = SAMPLE_INTERVAL_MS
  private started = false
  private observer?: PerformanceObserver
  private gc = { collections: 0, durationMs: 0 }
  private loopStart = performance.eventLoopUtilization()
  constructor(
    private readings: MemoryReadings = processReadings,
    private warn: (message: string) => void = (message) => console.warn(message),
  ) {}
  start(intervalMs = SAMPLE_INTERVAL_MS) {
    if (this.started) return
    this.started = true
    this.intervalMs = intervalMs
    this.observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        this.gc.collections++
        this.gc.durationMs += entry.duration
      }
    })
    this.observer.observe({ entryTypes: ['gc'] })
    this.sample()
    this.schedule()
  }
  private schedule() {
    if (!this.started) return
    const delay = this.open.size
      ? this.intervalMs
      : Math.max(this.intervalMs, IDLE_SAMPLE_INTERVAL_MS)
    const due = this.readings.now() + delay
    // Fast synchronous delta projections must not clear/recreate two timers per token. Keep
    // an earlier pending sample; once it fires idle work falls back to the slower interval.
    if (this.timer && this.timerAt !== undefined && this.timerAt <= due) return
    clearTimeout(this.timer)
    this.timerAt = due
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.timerAt = undefined
      this.sample()
      this.schedule()
    }, delay)
    this.timer.unref()
  }
  dispose() {
    this.started = false
    clearTimeout(this.timer)
    this.timer = undefined
    this.timerAt = undefined
    this.observer?.disconnect()
    this.observer = undefined
    this.open.clear()
    this.recent = []
    this.samples = []
  }
  /** Starts timing an expensive operation. Call the returned function exactly once. */
  begin(name: string) {
    const key = Symbol(name)
    if (this.open.size >= OPEN_OPERATIONS) this.open.delete(this.open.keys().next().value!)
    this.open.set(key, {
      name,
      startHeap: this.readings.heapUsed(),
      startedAt: this.readings.now(),
    })
    if (this.open.size === 1) {
      if (this.readings.now() - (this.samples.at(-1)?.at ?? -Infinity) >= this.intervalMs)
        this.sample()
      this.schedule()
    }
    return () => {
      const operation = this.open.get(key)
      if (!operation) return
      this.open.delete(key)
      if (!this.open.size) this.schedule()
      const heapGrowthBytes = this.readings.heapUsed() - operation.startHeap
      const durationMs = Math.max(0, this.readings.now() - operation.startedAt)
      if (heapGrowthBytes < OPERATION_GROWTH_BYTES && durationMs < OPERATION_SLOW_MS) return
      this.recent.push({
        name,
        endedAt: new Date(this.readings.now()).toISOString(),
        durationMs,
        heapGrowthBytes,
        ended: this.readings.now(),
      })
      if (this.recent.length > RECENT_OPERATIONS) this.recent.shift()
    }
  }
  /** Times `run`, including asynchronous completion and failure. */
  measure<T>(name: string, run: () => T): T {
    const end = this.begin(name)
    let result: T
    try {
      result = run()
    } catch (error) {
      end()
      throw error
    }
    if (result instanceof Promise) return result.finally(end) as T
    end()
    return result
  }
  sample() {
    const heap = this.readings.heapUsed(),
      external = this.readings.external(),
      now = this.readings.now()
    const inWindow = this.samples.filter((sample) => sample.at >= now - SPIKE_WINDOW_MS)
    // Idle timers can fire slightly late. Retain the preceding baseline rather than comparing
    // the new sample only to itself after a 10,001 ms wait (or a suspended host resumes).
    this.samples = (inWindow.length ? inWindow : this.samples.slice(-1)).slice(-10)
    this.samples.push({ at: now, heap, external })
    if (now < this.cooldownUntil) return
    const growthBytes = heap - Math.min(...this.samples.map((sample) => sample.heap))
    const externalGrowthBytes =
      external - Math.min(...this.samples.map((sample) => sample.external))
    if (growthBytes < SPIKE_GROWTH_BYTES && externalGrowthBytes < SPIKE_GROWTH_BYTES) return
    this.cooldownUntil = now + SPIKE_COOLDOWN_MS
    const windowSeconds = Math.max(1, Math.round((now - this.samples[0]!.at) / 1000))
    const suspects = [
      // Operations open since before the window, such as long agent turns, would claim all of it.
      ...[...this.open.values()]
        .filter(({ startedAt }) => startedAt >= now - SPIKE_WINDOW_MS)
        .map(({ name, startHeap }) => ({ name, heapGrowthBytes: heap - startHeap, running: true })),
      ...this.recent
        .filter(({ ended }) => ended >= now - SPIKE_WINDOW_MS)
        .map(({ name, heapGrowthBytes }) => ({ name, heapGrowthBytes, running: false })),
    ]
      .filter((suspect) => suspect.heapGrowthBytes >= OPERATION_GROWTH_BYTES)
      .sort((left, right) => right.heapGrowthBytes - left.heapGrowthBytes)
      .slice(0, REPORTED_SUSPECTS)
    const report = {
      at: new Date(this.readings.now()).toISOString(),
      heapUsedBytes: heap,
      growthBytes,
      externalBytes: external,
      externalGrowthBytes,
      rssBytes: this.readings.rss(),
      concurrentOperations: this.open.size,
      suspects,
    }
    this.spikes.push(report)
    if (this.spikes.length > SPIKE_REPORTS) this.spikes.shift()
    this.warn(
      `Runtime memory grew within ${windowSeconds} s: heap +${Math.round(growthBytes / MB)} MB, external +${Math.round(externalGrowthBytes / MB)} MB. ` +
        `Suspects: ${suspects.map((item) => `${item.name} +${Math.round(item.heapGrowthBytes / MB)} MB`).join(', ') || 'none recorded'}. ` +
        `${report.concurrentOperations} operations were running; concurrent work and garbage collection make this approximate.`,
    )
  }
  async report(children = childProcessMemory): Promise<RuntimeMemoryDiagnostics> {
    return {
      sampledAt: new Date(this.readings.now()).toISOString(),
      heapUsedBytes: this.readings.heapUsed(),
      heapLimitBytes: this.readings.heapLimit(),
      rssBytes: this.readings.rss(),
      externalBytes: this.readings.external(),
      arrayBufferBytes: this.readings.arrayBuffers(),
      gc: { ...this.gc },
      eventLoopUtilization: performance.eventLoopUtilization(this.loopStart).utilization,
      children: await children().catch(() => null),
      recent: this.recent
        .map(({ name, endedAt, durationMs, heapGrowthBytes }) => ({
          name,
          endedAt,
          durationMs,
          heapGrowthBytes,
        }))
        .reverse(),
      spikes: [...this.spikes].reverse(),
    }
  }
}

/**
 * Resident memory of this process's own descendants, from Linux procfs. Shared pages are
 * counted once per process, so the total overstates the memory they hold together.
 * Other platforms report null instead of an estimate.
 */
export async function childProcessMemory(
  root = process.pid,
  proc = '/proc',
  platform = process.platform,
): Promise<RuntimeMemoryDiagnostics['children']> {
  if (platform !== 'linux') return null
  const seen = new Set<number>([root])
  const queue = [root]
  let rssBytes = 0
  let processes = 0
  let truncated = false
  while (queue.length) {
    const pid = queue.shift()!
    let children: number[] = []
    try {
      // Threads other than the main one also fork, so read every task's children.
      for (const task of await readdir(`${proc}/${pid}/task`))
        children.push(
          ...(await readFile(`${proc}/${pid}/task/${task}/children`, 'utf8').catch(() => ''))
            .split(/\s+/)
            .filter(Boolean)
            .map(Number),
        )
    } catch {
      // The process exited while it was being read.
      if (pid === root) return null
      continue
    }
    if (pid === root && !children.length && !(await hasChildrenFile(proc, root))) return null
    children = children.filter((child) => Number.isInteger(child) && !seen.has(child))
    for (const child of children) {
      if (processes >= MAX_CHILD_PROCESSES) {
        truncated = true
        break
      }
      seen.add(child)
      const status = await readFile(`${proc}/${child}/status`, 'utf8').catch(() => '')
      if (!status) continue
      processes++
      // Zombies and kernel threads have no VmRSS line; they hold no resident memory.
      const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status)
      if (match) rssBytes += Number(match[1]) * 1024
      queue.push(child)
    }
  }
  return { processes, rssBytes, truncated }
}
// Kernels without CONFIG_PROC_CHILDREN cannot list descendants; report unavailable, not zero.
async function hasChildrenFile(proc: string, pid: number) {
  return readFile(`${proc}/${pid}/task/${pid}/children`).then(
    () => true,
    () => false,
  )
}

const attributions = new WeakMap<object, MemoryAttribution>()
/** The sampler for one runtime, started when first used and stopped with the runtime. */
export function memoryAttribution(owner: object) {
  let attribution = attributions.get(owner)
  if (!attribution) {
    attribution = new MemoryAttribution()
    attribution.start()
    attributions.set(owner, attribution)
  }
  return attribution
}
export function disposeMemoryAttribution(owner: object) {
  attributions.get(owner)?.dispose()
  attributions.delete(owner)
}

/** HTTP endpoints whose handler and response serialization can hold large values. */
export function expensiveRequestName(method: string | undefined, path: string) {
  if (method === 'GET' && path === '/api/snapshot') return 'snapshot'
  if (method !== 'POST') return undefined
  if (path === '/api/tasks/commits/read') return 'commit history'
  if (path === '/api/tasks/commits/changes') return 'commit diff'
  if (path === '/api/tasks/commits/file-preview') return 'commit file read'
  if (path === '/api/tasks/files/search-content') return 'file content search'
  if (path === '/api/tasks/files/search-paths') return 'file path search'
  if (path === '/api/tasks/files/directory') return 'directory page'
  if (path === '/api/tasks/history') return 'history page'
  if (path === '/api/tasks/search') return 'history search'
  if (
    path === '/api/scm/changes' ||
    path === '/api/scm/branch-changes' ||
    path === '/api/tasks/checkouts/changes'
  )
    return 'diff'
  if (path === '/api/scm/pulls/detail') return 'pull request diff'
  if (
    path === '/api/tasks/files/read' ||
    path === '/api/tasks/files/preview' ||
    path === '/api/tasks/file/preview' ||
    path === '/api/tasks/files/list'
  )
    return 'file read'
  if (path === '/api/artifacts/snapshot') return 'artifact snapshot'
  return undefined
}
