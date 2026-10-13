/** Cached SDK clients share event streams in v2. Pin them until run cleanup has finished. */
export class OpenCodeClientCache<T> {
  private readonly entries = new Map<string, { value: T; used: number; active: number }>()

  constructor(
    private readonly limit = 128,
    private readonly idleMs = 5 * 60 * 1000,
  ) {}

  private entry(key: string, create: () => T) {
    const now = Date.now()
    this.prune(now)
    const existing = this.entries.get(key)
    if (existing) {
      existing.used = now
      this.entries.delete(key)
      this.entries.set(key, existing)
      return existing
    }
    const entry = { value: create(), used: now, active: 0 }
    this.entries.set(key, entry)
    return entry
  }

  get(key: string, create: () => T) {
    const entry = this.entry(key, create)
    this.trim()
    return entry.value
  }

  acquire(key: string, create: () => T) {
    const entry = this.entry(key, create)
    entry.active++
    this.trim()
    let released = false
    return {
      value: entry.value,
      release: () => {
        if (released) return
        released = true
        entry.active--
        entry.used = Date.now()
        this.prune(entry.used)
        this.trim()
      },
    }
  }

  private trim() {
    // Active clients own shared streams: retain their keyed identity even above the idle cap.
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= this.limit) break
      if (!entry.active) this.entries.delete(key)
    }
  }

  private prune(now: number) {
    for (const [key, entry] of this.entries)
      if (!entry.active && now - entry.used >= this.idleMs) this.entries.delete(key)
  }
}
