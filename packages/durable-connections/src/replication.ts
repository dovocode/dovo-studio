import { startReconnecting } from './reconnecting.js'
import type { DurableState, StateRequest } from './state.js'
import { StateProtocolError } from './state.js'

export interface ReplicationOptions<T> {
  state: DurableState<T>
  /** Known source identity lets a new connection resume its durable receive checkpoint. */
  peerId?: string
  exchange(request: StateRequest<T>, signal: AbortSignal): Promise<unknown>
  /** Import domain edits before sending, and publish accepted state after receiving. */
  beforeExchange?: () => void | Promise<void>
  afterExchange?: () => void | Promise<void>
  onError(error: Error): void
  /** null keeps a caught-up connection idle until a local change or explicit wake. */
  intervalMs?: number | null
}

function wait(
  milliseconds: number | null,
  signal: AbortSignal,
  register: (wake: (() => void) | undefined) => void,
) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      register(undefined)
      resolve()
    }
    const timer = milliseconds === null ? undefined : setTimeout(done, milliseconds)
    signal.addEventListener('abort', done, { once: true })
    register(done)
  })
}

/** Sends batches until both sides are caught up, then waits. Lost responses replay safely.
 * A transport must honor AbortSignal and settle its request when cancelled. */
export function startReplication<T>(options: ReplicationOptions<T>) {
  const interval = options.intervalMs === undefined ? 3000 : options.intervalMs
  if (interval !== null && (!Number.isSafeInteger(interval) || interval < 1))
    throw new Error('Invalid replication interval')
  let waiting: (() => void) | undefined
  let pending = false
  const wake = () => {
    pending = true
    waiting?.()
  }
  const unsubscribe = options.state.subscribe(wake)
  let peer: string | undefined = options.peerId
  const connection = startReconnecting(
    async (signal, connected) => {
      let sentThrough = 0
      while (!signal.aborted) {
        pending = false
        await options.state.refresh()
        await options.beforeExchange?.()
        if (signal.aborted) return
        const request = options.state.request(peer, sentThrough)
        const response = await options.exchange(request, signal)
        // Late results from an old connection must never enter a replacement session.
        if (signal.aborted) return
        const accepted = await options.state.accept(response, options.peerId)
        if (accepted.sentThrough < request.batch.through)
          throw new StateProtocolError('Peer did not acknowledge the submitted state batch')
        await options.afterExchange?.()
        if (signal.aborted) return
        peer = accepted.peer
        sentThrough = accepted.sentThrough
        connected()
        if (!accepted.more && !pending)
          await wait(interval, signal, (callback) => {
            waiting = callback
          })
      }
    },
    (error) => options.onError(error),
  )
  return {
    ...connection,
    wake,
    stop: async () => {
      unsubscribe()
      await connection.stop()
    },
  }
}
