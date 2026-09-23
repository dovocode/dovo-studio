/** Application-level acknowledgements detect blackholed browser sockets, even on idle terminals. */
export function startSocketHeartbeat(send: (message: string) => void, expired: () => void) {
  let sequence = 0
  let waiting: string | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const stop = () => {
    stopped = true
    clearInterval(interval)
    clearTimeout(deadline)
  }
  const ping = () => {
    if (stopped || waiting) return
    waiting = String(++sequence)
    deadline = setTimeout(() => {
      stop()
      expired()
    }, 10000)
    try {
      send(JSON.stringify({ type: 'ping', nonce: waiting }))
    } catch {
      stop()
      expired()
    }
  }
  const interval = setInterval(ping, 15000)
  ping()
  return {
    stop,
    receive(data: unknown) {
      if (stopped || !(data instanceof ArrayBuffer)) return
      try {
        const value: unknown = JSON.parse(new TextDecoder().decode(data))
        if (
          value &&
          typeof value === 'object' &&
          'type' in value &&
          value.type === 'pong' &&
          'nonce' in value &&
          value.nonce === waiting
        ) {
          waiting = undefined
          clearTimeout(deadline)
        }
      } catch {
        /* Non-heartbeat binary frames do not acknowledge a ping. */
      }
    },
  }
}
