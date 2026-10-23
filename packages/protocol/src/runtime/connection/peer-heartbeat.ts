export const PEER_HEARTBEAT_HELLO = 'dovo-heartbeat-v1'
export const PEER_HEARTBEAT_INTERVAL_MS = 5000
export const PEER_HEARTBEAT_TIMEOUT_MS = 20000

/** Negotiate before probing: older computers close the ready channel on any message. */
export function createPeerHeartbeat(options: {
  send: (value: string) => void
  onTimeout: () => void
  connected: () => boolean
  onRoundTrip?: (milliseconds: number) => void
}) {
  let announced = false
  let enabled = false
  let stopped = false
  let pending: number | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = () => {
    stopped = true
    clearTimeout(timer)
    timer = undefined
  }
  const send = (value: string) => {
    if (stopped) return
    try {
      options.send(value)
    } catch {
      stop()
      options.onTimeout()
    }
  }
  const announce = () => {
    if (announced || stopped) return
    announced = true
    send(PEER_HEARTBEAT_HELLO)
  }
  const tick = () => {
    if (stopped) return
    if (!options.connected()) pending = undefined
    else if (pending !== undefined && Date.now() - pending >= PEER_HEARTBEAT_TIMEOUT_MS) {
      stop()
      options.onTimeout()
      return
    } else if (pending === undefined) {
      pending = Date.now()
      send('ping')
    }
    if (!stopped) timer = setTimeout(tick, PEER_HEARTBEAT_INTERVAL_MS)
  }
  return {
    announce,
    stop,
    receive: (value: unknown) => {
      if (stopped) return false
      if (value === PEER_HEARTBEAT_HELLO) {
        if (!enabled) {
          enabled = true
          announce()
          if (!stopped) timer = setTimeout(tick, PEER_HEARTBEAT_INTERVAL_MS)
        }
      } else if (enabled && value === 'ping') send('pong')
      else if (enabled && value === 'pong') {
        if (pending !== undefined) {
          options.onRoundTrip?.(Math.max(0, Date.now() - pending))
          pending = undefined
        }
      } else return false
      return true
    },
  }
}
