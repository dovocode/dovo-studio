export type ConditionalReadReply<T> =
  | { value: T; version?: string }
  | { unchanged: true; version: string }

type Entry<T> = { value: T; version?: string; checked: number; bytes: number }

/** Share in-flight reads and exact live baselines. Disk snapshots never authorize a conditional read. */
export class ConditionalReadCache<T> {
  private entries = new Map<string, Entry<T>>()
  private pending = new Map<string, { promise: Promise<T>; forced: boolean }>()
  private bytes = 0
  constructor(private readonly maxBytes = 8 * 1024 * 1024) {}
  read(
    key: string,
    request: (version?: string) => Promise<ConditionalReadReply<T>>,
    refresh = false,
  ): Promise<T> {
    const running = this.pending.get(key)
    if (running) {
      if (refresh && !running.forced) {
        // One forced successor, shared by callers. A user refresh never joins an older read.
        const next = () => this.read(key, request, true)
        return running.promise.then(next, next)
      }
      return running.promise
    }
    const previous = this.entries.get(key)
    if (!refresh && previous?.version && Date.now() - previous.checked < 1000)
      return Promise.resolve(previous.value)
    const promise = Promise.resolve()
      .then(async () => {
        const reply = await request(previous?.version)
        let entry: Entry<T>
        if ('unchanged' in reply) {
          if (!previous || !previous.version || reply.version !== previous.version)
            throw new Error('The response has no matching live baseline. Refresh the view.')
          entry = { ...previous, checked: Date.now() }
        } else {
          entry = {
            value: reply.value,
            version: reply.version,
            checked: Date.now(),
            bytes: JSON.stringify(reply.value).length * 2,
          }
        }
        this.bytes -= this.entries.get(key)?.bytes ?? 0
        this.entries.delete(key)
        if (entry.bytes <= this.maxBytes) {
          this.entries.set(key, entry)
          this.bytes += entry.bytes
          while (this.entries.size > 64 || this.bytes > this.maxBytes) {
            const oldest = this.entries.keys().next().value
            if (oldest === undefined) break
            this.bytes -= this.entries.get(oldest)?.bytes ?? 0
            this.entries.delete(oldest)
          }
        }
        return entry.value
      })
      .finally(() => this.pending.delete(key))
    this.pending.set(key, { promise, forced: refresh })
    return promise
  }
}
