type Clock = { listeners: Set<() => void>; timer: ReturnType<typeof setInterval> }
const clocks = new Map<number, Clock>()

/** Share one timer per cadence and stop it when the last subscriber leaves. */
export function subscribeClock(interval: number, listener: () => void) {
  let clock = clocks.get(interval)
  if (!clock) {
    const listeners = new Set<() => void>()
    clock = {
      listeners,
      timer: setInterval(() => {
        for (const notify of [...listeners]) notify()
      }, interval),
    }
    clocks.set(interval, clock)
  }
  const current = clock
  current.listeners.add(listener)
  return () => {
    current.listeners.delete(listener)
    if (current.listeners.size || clocks.get(interval) !== current) return
    clearInterval(current.timer)
    clocks.delete(interval)
  }
}
