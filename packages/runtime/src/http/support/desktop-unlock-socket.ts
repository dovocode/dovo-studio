import { createConnection, type Socket } from 'node:net'
import { WebSocket } from 'ws'

/** Opaque RFB relay to the OS service only. Credentials and pixels never enter activity logs. */
export function attachDesktopUnlockSocket(
  client: WebSocket,
  authorize: () => void,
  attach: (close: () => void) => () => void,
  connect: () => Socket = () => createConnection({ host: '127.0.0.1', port: 5900 }),
) {
  let native: Socket | undefined
  let detach: (() => void) | undefined
  let closed = false
  let connected = false
  const cleanup = () => {
    if (closed) return
    closed = true
    clearInterval(watchdog)
    clearTimeout(deadline)
    native?.destroy()
    detach?.()
  }
  const close = (code: number, reason: string) => {
    cleanup()
    client.close(code, reason)
  }
  const deadline = setTimeout(
    () =>
      close(
        1011,
        'Screen Sharing unavailable. Enable it in macOS System Settings > General > Sharing.',
      ),
    5000,
  ).unref()
  const watchdog = setInterval(() => {
    try {
      authorize()
    } catch {
      close(1008, 'Desktop unlock access ended')
    }
  }, 1000).unref()
  client.on('close', cleanup)
  client.on('error', cleanup)
  try {
    authorize()
    detach = attach(() => close(1000, 'Desktop unlock ended'))
    native = connect()
    const socket = native
    socket.setNoDelay(true)
    socket.on('connect', () => {
      connected = true
      clearTimeout(deadline)
    })
    socket.on('data', (chunk: Buffer) => {
      try {
        authorize()
        if (closed || client.readyState !== WebSocket.OPEN) return cleanup()
        // RFB is an ordered byte stream: pause instead of dropping or buffering stale frames.
        socket.pause()
        client.send(chunk, { binary: true }, (error) => {
          if (error) close(1011, 'Screen Sharing connection interrupted')
          else if (!closed) socket.resume()
        })
      } catch {
        close(1008, 'Desktop unlock access ended')
      }
    })
    socket.on('error', () =>
      close(
        1011,
        connected
          ? 'Screen Sharing connection interrupted'
          : 'Screen Sharing unavailable. Enable it in macOS System Settings > General > Sharing.',
      ),
    )
    socket.on('close', () => close(1000, 'Screen Sharing disconnected'))
    client.on('message', (data, binary) => {
      try {
        authorize()
        if (closed) return
        if (!binary || !connected || socket.writableLength > 1024 * 1024)
          return close(1008, 'Invalid or congested Screen Sharing connection')
        socket.write(
          Array.isArray(data)
            ? Buffer.concat(data)
            : Buffer.isBuffer(data)
              ? data
              : Buffer.from(data),
        )
      } catch {
        close(1008, 'Desktop unlock access ended')
      }
    })
  } catch {
    close(1008, 'Desktop unlock unavailable')
  }
}
