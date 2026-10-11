import { freemem, totalmem } from 'node:os'

/** Host pressure includes provider children; runtime RSS alone cannot account for them. */
export function releaseIdleProvider() {
  const total = totalmem()
  return (
    process.memoryUsage().rss > Math.min(1024 * 1024 * 1024, total / 4) ||
    freemem() < Math.min(512 * 1024 * 1024, total / 10)
  )
}

const idleLifetime = 2 * 60 * 1000
const maxIdleProviders = 4
type Candidate = { idleAt: number; expiresAt: number; release: () => Promise<void> }
const pools = new Set<{ candidates: () => Candidate[] }>()
let timer: ReturnType<typeof setInterval> | undefined

async function pruneIdleProviders(pressure: boolean) {
  const candidates = [...pools]
    .flatMap((pool) => pool.candidates())
    .sort((a, b) => a.idleAt - b.idleAt)
  const now = Date.now()
  const results = await Promise.allSettled(
    candidates
      .filter(
        (candidate, index) =>
          pressure || candidate.expiresAt <= now || index < candidates.length - maxIdleProviders,
      )
      .map((candidate) => candidate.release()),
  )
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  )
  // Budget cleanup is maintenance across all harnesses, not part of the current turn's result.
  if (failures.length)
    console.error(
      'Could not clean up idle agent providers:',
      new AggregateError(failures, 'Could not release idle agent providers'),
    )
}

/** A shared idle budget across harnesses. Sessions with working native children remain owned. */
export class IdleProviders<T> {
  private held = new Map<string, { value: T; idleAt: number; expiresAt: number }>()
  constructor(
    private close: (value: T) => Promise<void>,
    private working: (value: T) => boolean = () => false,
  ) {}
  get(key: string) {
    return this.held.get(key)?.value
  }
  set(key: string, value: T) {
    this.held.set(key, { value, idleAt: Date.now(), expiresAt: Date.now() + idleLifetime })
    pools.add(this)
    timer ??= setInterval(() => {
      void pruneIdleProviders(releaseIdleProvider()).catch((error) =>
        console.error('Could not clean up idle agent providers:', error),
      )
    }, 15_000)
    timer.unref()
  }
  delete(key: string) {
    const removed = this.held.delete(key)
    if (!this.held.size) {
      pools.delete(this)
      if (!pools.size) {
        clearInterval(timer)
        timer = undefined
      }
    }
    return removed
  }
  clear() {
    for (const key of this.held.keys()) this.delete(key)
  }
  *values() {
    for (const { value } of this.held.values()) yield value
  }
  *entries(): IterableIterator<[string, T]> {
    for (const [key, { value }] of this.held) yield [key, value]
  }
  [Symbol.iterator]() {
    return this.entries()
  }
  candidates(): Candidate[] {
    return [...this.held].flatMap(([key, record]) =>
      this.working(record.value)
        ? []
        : [{ ...record, release: () => this.release(key, record.value) }],
    )
  }
  async release(key: string, expected = this.get(key)) {
    const record = this.held.get(key)
    if (!record || record.value !== expected) return
    // A completed Dovo child may still own provider-native children. Release it when they end.
    record.expiresAt = 0
    if (this.working(record.value)) return
    this.delete(key)
    await this.close(record.value)
  }
  prune(pressure = releaseIdleProvider()) {
    return pruneIdleProviders(pressure)
  }
}
