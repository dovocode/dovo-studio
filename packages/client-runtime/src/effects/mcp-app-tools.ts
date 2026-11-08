import { startReconnecting } from './reconnecting.js'

/** Ticket-authenticated live view transport, shared by browser and native WebView hosts. */
export function startMcpAppTools(options: {
  socketUrl: (ticket: string) => string
  ticket: () => Promise<string>
  call: (value: { requestId: string; name: string; arguments: unknown }) => void
  cancel: (requestId: string) => void
  onError: (error: Error) => void
  visible?: boolean
}) {
  let socket: WebSocket | undefined
  let tools: unknown[] = []
  const pending = new Set<string>()
  let visible = options.visible !== false
  let stopped = false
  let connection: ReturnType<typeof startReconnecting> | undefined
  let stopping: Promise<void> | undefined
  const send = (value: unknown) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value))
  }
  const start = () =>
    startReconnecting(async (signal, connected) => {
      const ticket = await options.ticket()
      if (signal.aborted) return
      const url = options.socketUrl(ticket)
      await new Promise<void>((resolve, reject) => {
        const current = new WebSocket(url.toString())
        socket = current
        const cleanup = () => {
          clearTimeout(timeout)
          signal.removeEventListener('abort', abort)
          current.onopen = current.onmessage = current.onclose = current.onerror = null
          current.close()
          if (socket === current) socket = undefined
          for (const requestId of pending) options.cancel(requestId)
          pending.clear()
          queueMicrotask(suspendIfIdle)
        }
        const abort = () => {
          cleanup()
          resolve()
        }
        const fail = () => {
          cleanup()
          reject(new Error('MCP App tools disconnected; reconnecting'))
        }
        const timeout = setTimeout(fail, 10000)
        signal.addEventListener('abort', abort, { once: true })
        current.onopen = () => {
          clearTimeout(timeout)
          connected()
          send({ type: 'tools', tools })
        }
        current.onclose = fail
        current.onerror = fail
        current.onmessage = (event) => {
          try {
            const value: unknown = JSON.parse(String(event.data))
            if (
              !value ||
              typeof value !== 'object' ||
              !('type' in value) ||
              !('requestId' in value) ||
              typeof value.requestId !== 'string'
            )
              return
            if (value.type === 'cancel') {
              pending.delete(value.requestId)
              options.cancel(value.requestId)
              suspendIfIdle()
            }
            if (
              value.type === 'call' &&
              'name' in value &&
              typeof value.name === 'string' &&
              'arguments' in value
            ) {
              pending.add(value.requestId)
              options.call({
                requestId: value.requestId,
                name: value.name,
                arguments: value.arguments,
              })
            }
          } catch {
            fail()
          }
        }
      })
    }, options.onError)
  const suspendIfIdle = () => {
    if (visible || pending.size || !connection || stopping) return
    const current = connection
    connection = undefined
    stopping = current.stop().then(() => {
      stopping = undefined
      if (visible && !stopped) connection = start()
    })
  }
  if (visible) connection = start()
  return {
    setVisible(value: boolean) {
      visible = value
      if (visible && !stopped && !connection && !stopping) connection = start()
      else suspendIfIdle()
    },
    setTools(value: unknown[]) {
      tools = value
      send({ type: 'tools', tools })
    },
    reply(value: { requestId: string; result?: unknown; error?: string }) {
      if (!pending.delete(value.requestId)) return
      send({ ...value, type: 'result' })
      suspendIfIdle()
    },
    async stop() {
      stopped = true
      await connection?.stop()
      await stopping
    },
  }
}
