/** Shared checkout work owns its cancellation; individual callers own only their wait. */
export class PendingCheckouts<T> {
  private pending = new Map<
    string,
    { controller: AbortController; callers: Set<symbol>; result: Promise<T> }
  >()

  run(id: string, prepare: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted()
    let entry = this.pending.get(id)
    if (!entry) {
      const controller = new AbortController()
      const result = Promise.resolve()
        .then(() => prepare(controller.signal))
        .finally(() => this.pending.delete(id))
      entry = { controller, callers: new Set(), result }
      this.pending.set(id, entry)
    }
    const shared = entry
    const caller = Symbol()
    shared.callers.add(caller)
    return new Promise<T>((resolve, reject) => {
      let cancelled = false
      const release = () => {
        shared.callers.delete(caller)
        signal?.removeEventListener('abort', abort)
      }
      const abort = () => {
        cancelled = true
        release()
        if (shared.callers.size) reject(signal?.reason)
        else {
          // Keep the last caller's ownership until the setup process has drained.
          shared.controller.abort(signal?.reason)
          void shared.result.then(
            () => reject(signal?.reason),
            (error: unknown) => reject(error),
          )
        }
      }
      signal?.addEventListener('abort', abort, { once: true })
      void shared.result.then(
        (value) => {
          release()
          if (!cancelled) resolve(value)
        },
        (error: unknown) => {
          release()
          if (!cancelled) reject(error)
        },
      )
    })
  }
}
