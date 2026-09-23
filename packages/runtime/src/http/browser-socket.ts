import { decodeResult, decode } from '@dovo/protocol'
import { WebSocket } from 'ws'
import {
  encodeBrowserFrame,
  remoteBrowserFrameAckSchema,
  remoteBrowserInputSchema,
} from '@dovo/protocol'
import type { BrowserFrame, BrowserOutput } from '../previews/browser.js'
import type { Services } from '../services.js'
import { errorMessage } from '../errors.js'
export function attachBrowserSocket(
  client: WebSocket,
  taskId: string,
  token: string,
  services: Services,
  binary = false,
  simulatorId?: string,
) {
  const source = simulatorId ? services.simulators : services.browsers
  const resourceId = simulatorId ?? taskId
  let closed = false
  let detach: (() => void) | undefined
  let frame: BrowserFrame | undefined
  let flush: ReturnType<typeof setTimeout> | undefined
  let sequence = 0
  const inFlight = new Map<number, number>()
  const send = (message: BrowserOutput) => {
    if (closed || client.readyState !== WebSocket.OPEN) return
    if (message.type === 'frame') {
      // Bound work all the way through the client's decoder, not just the OS socket.
      // Two frames allow capture and rendering to overlap without building latency.
      if ((binary && inFlight.size >= 2) || client.bufferedAmount > 256 * 1024) {
        frame = message
        if (!flush && (!binary || inFlight.size < 2))
          flush = setTimeout(() => {
            flush = undefined
            drain()
          }, 16)
        return
      }
      clearTimeout(flush)
      flush = undefined
      frame = undefined
      if (binary) {
        const id = ++sequence
        inFlight.set(id, Date.now())
        client.send(encodeBrowserFrame(message, id))
      } else
        client.send(
          JSON.stringify({
            ...message,
            data: Buffer.from(message.data).toString('base64'),
          }),
        )
    } else client.send(JSON.stringify(message))
    if (message.type === 'closed') client.close(1000, 'Browser session closed')
  }
  const drain = () => {
    const next = frame
    frame = undefined
    if (next) send(next)
  }
  const watchdog = binary
    ? setInterval(() => {
        const oldest = inFlight.values().next().value
        if (oldest !== undefined && Date.now() - oldest > 10000)
          client.close(1008, 'Browser renderer stopped responding')
      }, 2000)
    : undefined
  watchdog?.unref()
  const cleanup = () => {
    closed = true
    clearTimeout(flush)
    clearInterval(watchdog)
    frame = undefined
    inFlight.clear()
    detach?.()
    detach = undefined
  }
  client.on('close', cleanup)
  client.on('error', cleanup)
  void source
    .attach(resourceId, send)
    .then((dispose) => {
      if (closed) dispose()
      else detach = dispose
    })
    .catch((error) => {
      send({
        type: 'error',
        message: errorMessage(error),
      })
      client.close(1011, 'Browser connection failed')
    })
  const authorize = () => {
    if (client.readyState !== WebSocket.OPEN) throw new Error('Browser controller disconnected')
    services.devices.authenticate(token)
    services.store.task(taskId)
  }
  let count = 0,
    windowStart = Date.now()
  client.on('message', (raw) => {
    try {
      authorize()
      const data = Array.isArray(raw)
        ? Buffer.concat(raw)
        : Buffer.isBuffer(raw)
          ? raw
          : Buffer.from(raw)
      const value: unknown = JSON.parse(data.toString())
      const ack = decodeResult(remoteBrowserFrameAckSchema, value)
      if (binary && ack.success) {
        if (!inFlight.delete(ack.data.sequence))
          throw new Error('Invalid browser frame acknowledgement')
        drain()
        return
      }
      if (Date.now() - windowStart > 1000) {
        count = 0
        windowStart = Date.now()
      }
      if (++count > 200) throw new Error('Too many browser commands')
      const input = decode(remoteBrowserInputSchema, value)
      void source.input(resourceId, input, authorize).catch((error) => {
        send({
          type: 'error',
          message: errorMessage(error),
        })
      })
    } catch {
      client.close(1008, 'Invalid browser command or revoked device')
    }
  })
}
