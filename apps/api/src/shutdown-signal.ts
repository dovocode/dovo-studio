import type { EventEmitter } from 'node:events'

/** Own shutdown before asynchronous initialization, including IPC disconnect during startup. */
export function shutdownSignal(target: Pick<EventEmitter, 'on' | 'removeListener'>) {
  const controller = new AbortController()
  const events = ['SIGINT', 'SIGTERM', 'disconnect'] as const
  const stop = () => controller.abort()
  for (const event of events) target.on(event, stop)
  return {
    signal: controller.signal,
    dispose() {
      for (const event of events) target.removeListener(event, stop)
    },
  }
}
