/** Bounded discovery cache: stale values remain readable while a shared request refreshes them. */
export class DiscoveryCache<T> {
  private readonly entries = new Map<string, { value: T; expires: number }>()
  private readonly pending = new Map<string, Promise<T>>()
  private readonly listeners = new Set<() => void>()
  constructor(private readonly ttl: number) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  peek(key: string): T | null {
    return this.entries.get(key)?.value ?? null
  }
  isFresh(key: string): boolean {
    return (this.entries.get(key)?.expires ?? 0) > Date.now()
  }
  load(key: string, request: () => Promise<T>, refresh = false): Promise<T> {
    const running = this.pending.get(key)
    if (running) return running
    const cached = this.entries.get(key)
    if (!refresh && cached && this.isFresh(key)) return Promise.resolve(cached.value)
    const promise = Promise.resolve()
      .then(request)
      .then((value) => {
        this.entries.delete(key)
        this.entries.set(key, { value, expires: Date.now() + this.ttl })
        if (this.entries.size > 64) {
          const oldest = this.entries.keys().next().value
          if (oldest !== undefined) this.entries.delete(oldest)
        }
        for (const listener of this.listeners) listener()
        return value
      })
      .finally(() => {
        this.pending.delete(key)
      })
    this.pending.set(key, promise)
    return promise
  }
}
