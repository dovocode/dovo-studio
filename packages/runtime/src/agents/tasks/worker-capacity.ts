type Waiting = {
  signal: AbortSignal
  ready: () => void
  reject: (reason: unknown) => void
  position: (position: number) => void
  abort: () => void
}

/** Reserve one slot for direct conversation work. Never interrupt a running provider. */
export class WorkerCapacity {
  private waiting: Waiting[] = []
  private timer?: ReturnType<typeof setTimeout>
  constructor(private available: () => boolean) {}

  acquire(signal: AbortSignal, granted: () => void, position: (position: number) => void) {
    signal.throwIfAborted()
    return new Promise<void>((resolve, reject) => {
      const entry: Waiting = {
        signal,
        position,
        reject,
        ready: () => {
          granted()
          resolve()
        },
        abort: () => {
          this.waiting = this.waiting.filter((item) => item !== entry)
          signal.removeEventListener('abort', entry.abort)
          reject(signal.reason)
          this.drain()
        },
      }
      this.waiting.push(entry)
      signal.addEventListener('abort', entry.abort, { once: true })
      this.drain()
    })
  }
  drain() {
    clearTimeout(this.timer)
    this.timer = undefined
    while (this.waiting.length && this.available()) {
      const entry = this.waiting.shift()!
      entry.signal.removeEventListener('abort', entry.abort)
      entry.ready()
    }
    this.waiting.forEach((entry, index) => entry.position(index + 1))
    if (this.waiting.length) {
      this.timer = setTimeout(() => this.drain(), 1000)
      this.timer.unref()
    }
  }
}
