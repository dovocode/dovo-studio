import { decodeResult, decode } from '@dovo/protocol'
import { WebSocket } from 'ws'
import {
  encodeBrowserFrame,
  remoteBrowserFrameAckSchema,
  remoteBrowserInputSchema,
  simulatorInputSchema,
} from '@dovo/protocol'
import type { BrowserFrame, BrowserOutput } from '../../previews/browser.js'
import type { Services } from '../../services.js'
import { errorMessage } from '../../errors.js'
export function attachBrowserSocket(
  client: WebSocket,
  taskId: string,
  token: string,
  services: Services,
  binary = false,
  simulatorId?: string,
  browserId = taskId,
  foreignAuthorize?: () => void,
  metrics = false,
) {
  const source = simulatorId
    ? foreignAuthorize
      ? services.hostSimulators
      : services.simulators
    : services.browsers
  const resourceId = simulatorId ?? browserId
  let visible = true
  let closed = false
  let detach: (() => void) | undefined
  let frame: BrowserFrame | undefined
  let flush: ReturnType<typeof setTimeout> | undefined
  let sequence = 0
  let frameWindow = 2
  let inFlightBytes = 0
  let transportMs: number | undefined
  let minimumTransportMs = Infinity
  let minimumTransportAt = 0
  let deliveryIntervalMs = 16
  let deliveryMeasuredAt = 0
  let previousDelivery: { sentAt: number; receivedAt: number } | undefined
  let congestedSamples = 0
  let growAfter = 0
  let resumedAt = 0
  let lastMetricsAt = -Infinity
  const inFlight = new Map<number, { sentAt: number; bytes: number }>()
  const send = (message: BrowserOutput) => {
    if (closed || client.readyState !== WebSocket.OPEN) return
    if (message.type === 'frame') {
      // Keep enough frames in transit for the measured round trip, but never
      // build an unbounded queue in a slow network or decoder. Only the latest
      // unsent frame survives. Large stills travel alone once prior frames clear.
      const creditBlocked =
        binary &&
        (inFlight.size >= frameWindow ||
          (inFlight.size > 0 && inFlightBytes + message.data.byteLength > 256 * 1024))
      if (creditBlocked || client.bufferedAmount > 0) {
        frame = message
        if (!flush && !creditBlocked)
          flush = setTimeout(() => {
            flush = undefined
            drain()
          }, 4)
        return
      }
      clearTimeout(flush)
      flush = undefined
      frame = undefined
      if (binary) {
        const id = ++sequence
        const packet = encodeBrowserFrame(message, id)
        inFlight.set(id, { sentAt: performance.now(), bytes: message.data.byteLength })
        inFlightBytes += message.data.byteLength
        client.send(packet, (error) => {
          if (!error) drain()
        })
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
        if (!visible) return
        const oldest = inFlight.values().next().value
        if (oldest !== undefined && performance.now() - Math.max(oldest.sentAt, resumedAt) > 10000)
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
    if (foreignAuthorize) foreignAuthorize()
    else services.store.taskSummary(taskId)
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
        const sent = inFlight.get(ack.data.sequence)
        if (!sent) throw new Error('Invalid browser frame acknowledgement')
        inFlight.delete(ack.data.sequence)
        inFlightBytes -= sent.bytes
        if (ack.data.decodeMs !== undefined && !ack.data.dropped) {
          const now = performance.now()
          const sample = Math.max(0, now - sent.sentAt - ack.data.decodeMs)
          transportMs = transportMs === undefined ? sample : transportMs * 0.8 + sample * 0.2
          // Closely sent frames reveal link serialization through their ACK
          // spacing. RTT alone includes that serialization and would open an
          // ever larger window on a narrow link. Ignore idle/burst ACK samples;
          // learn slower delivery promptly and recover as delivery speeds up.
          // Re-probe after a route/bandwidth change even if the constrained
          // window no longer produces closely spaced frames to measure.
          if (now - deliveryMeasuredAt > 10000) deliveryIntervalMs = 16
          if (previousDelivery && ack.data.decodeMs <= 24) {
            const sentGap = sent.sentAt - previousDelivery.sentAt
            const deliveredGap = now - previousDelivery.receivedAt
            if (sentGap > 0 && sentGap <= 32 && deliveredGap > 0) {
              deliveryMeasuredAt = now
              deliveryIntervalMs = Math.max(
                16,
                deliveredGap,
                deliveryIntervalMs * 0.8 + deliveredGap * 0.2,
              )
            }
          }
          previousDelivery = { sentAt: sent.sentAt, receivedAt: now }
          // Age the baseline so a VPN/Wi-Fi route change can establish its new
          // RTT instead of being mistaken for congestion for this whole session.
          if (sample < minimumTransportMs || now - minimumTransportAt > 10000) {
            minimumTransportMs = sample
            minimumTransportAt = now
          }
          const congested = sample > minimumTransportMs + Math.max(24, minimumTransportMs * 0.3)
          congestedSamples = congested ? Math.min(2, congestedSamples + 1) : 0
          // A slow decoder needs backpressure, rather than more frames. A fast
          // decoder on a high-RTT network can pipeline up to eight 60Hz frames.
          // Rising RTT signals network queueing: cut the window and recover
          // gradually, rather than amplifying congestion with more stale images.
          if (ack.data.decodeMs > 24 || congestedSamples >= 2) {
            // Ignore isolated scheduler/network spikes. At the minimum window,
            // recurring jitter must not postpone every recovery probe forever.
            if (ack.data.decodeMs > 24 || frameWindow > 2) growAfter = now + 1000
            frameWindow = ack.data.decodeMs > 24 ? 2 : Math.max(2, Math.floor(frameWindow / 2))
          } else {
            const target = Math.min(
              8,
              Math.max(2, Math.floor(minimumTransportMs / deliveryIntervalMs)),
            )
            if (!growAfter) frameWindow = Math.min(target, frameWindow + 1)
            else if (now >= growAfter) {
              frameWindow = Math.min(target, frameWindow + 1)
              growAfter = now + 250
            }
          }
        }
        // Frame delivery takes priority over optional diagnostic messages.
        drain()
        if (
          metrics &&
          !simulatorId &&
          !ack.data.dropped &&
          transportMs !== undefined &&
          performance.now() - lastMetricsAt >= 1000
        ) {
          lastMetricsAt = performance.now()
          send({ type: 'streamStats', transportMs: Math.min(60000, transportMs) })
        }
        return
      }
      if (Date.now() - windowStart > 1000) {
        count = 0
        windowStart = Date.now()
      }
      if (++count > (simulatorId ? 200 : 400)) throw new Error('Too many browser commands')
      const input = simulatorId
        ? decode(simulatorInputSchema, value)
        : decode(remoteBrowserInputSchema, value)
      if (input.type === 'visibility' && !simulatorId) {
        visible = input.visible
        if (visible) resumedAt = performance.now()
      }
      const operation =
        input.type === 'visibility' && !simulatorId
          ? services.browsers.visibility(resourceId, send, input.visible)
          : simulatorId
            ? (foreignAuthorize ? services.hostSimulators : services.simulators).input(
                resourceId,
                input,
                authorize,
              )
            : services.browsers.input(
                resourceId,
                decode(remoteBrowserInputSchema, value),
                authorize,
              )
      void operation.catch((error) => {
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
