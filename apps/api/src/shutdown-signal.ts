import type { EventEmitter } from 'node:events'

/** Own shutdown before asynchronous initialization, including IPC disconnect during startup. */
export function shutdownSignal(
  target: Pick<EventEmitter, 'on' | 'removeListener'>,
  forceExit: (code: number) => void = (code) => process.exit(code),
) {
  const controller = new AbortController()
  const handlers = {
    SIGINT: () => (controller.signal.aborted ? forceExit(130) : controller.abort()),
    SIGTERM: () => (controller.signal.aborted ? forceExit(143) : controller.abort()),
    disconnect: () => controller.abort(),
  }
  for (const [event, stop] of Object.entries(handlers)) target.on(event, stop)
  return {
    signal: controller.signal,
    dispose() {
      for (const [event, stop] of Object.entries(handlers)) target.removeListener(event, stop)
    },
  }
}
