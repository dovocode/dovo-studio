import { startReconnecting } from './reconnecting.js'

/** Ticket-authenticated live view transport, shared by browser and native WebView hosts. */
export function startMcpAppTools(options: {
  address: string
  ticket: () => Promise<string>
  call: (value: { requestId: string; name: string; arguments: unknown }) => void
  cancel: (requestId: string) => void
  onError: (error: Error) => void
}) {
  let socket: WebSocket | undefined
  let tools: unknown[] = []
  const pending = new Set<string>()
  const send = (value: unknown) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value))
  }
  const connection = startReconnecting(async (signal, connected) => {
    const ticket = await options.ticket()
    if (signal.aborted) return
    const url = new URL('/ws/mcp-app', options.address)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('ticket', ticket)
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
  return {
    setTools(value: unknown[]) {
      tools = value
      send({ type: 'tools', tools })
    },
    reply(value: { requestId: string; result?: unknown; error?: string }) {
      if (!pending.delete(value.requestId)) return
      send({ ...value, type: 'result' })
    },
    stop: () => connection.stop(),
  }
}
