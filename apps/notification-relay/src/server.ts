import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'
import {
  decode,
  relayNotificationSchema,
  ValidationError,
  type RelayNotification,
} from '@dovo/protocol'
import type { DeliveryResult } from './delivery.js'

const digest = (value: string) => createHash('sha256').update(value).digest()
export function createRelay(options: {
  token: string
  platforms: { ios: boolean; android: boolean }
  send: (value: RelayNotification) => Promise<DeliveryResult>
}) {
  if (options.token.length < 32)
    throw new Error('DOVO_RELAY_TOKEN must contain at least 32 characters')
  const recent = new Map<string, { expires: number; result: DeliveryResult }>()
  const pending = new Map<string, Promise<DeliveryResult>>()
  let active = 0
  const respond = (response: ServerResponse, status: number, value: object) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    response.end(JSON.stringify(value))
  }
  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    if (request.method === 'GET' && request.url === '/health')
      return respond(response, 200, { ok: true, platforms: options.platforms })
    if (
      !timingSafeEqual(
        digest(request.headers.authorization ?? ''),
        digest(`Bearer ${options.token}`),
      )
    )
      return respond(response, 401, { error: 'Relay authentication required' })
    if (request.method !== 'POST' || request.url !== '/v1/notifications')
      return respond(response, 404, { error: 'Not found' })
    if (active >= 16) return respond(response, 429, { error: 'Relay is busy; retry later' })
    active++
    try {
      const chunks: Buffer[] = []
      let bytes = 0
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        bytes += buffer.length
        if (bytes > 16_384) return respond(response, 413, { error: 'Notification is too large' })
        chunks.push(buffer)
      }
      let value: RelayNotification
      try {
        value = decode(relayNotificationSchema, JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        if (error instanceof SyntaxError || error instanceof ValidationError)
          return respond(response, 400, { error: 'Invalid notification' })
        throw error
      }
      if (value.platform === 'ios' && !/^[a-fA-F0-9]{32,512}$/.test(value.token))
        return respond(response, 400, { error: 'Invalid Apple token' })
      if (!options.platforms[value.platform])
        return respond(response, 503, { error: 'Push provider is not configured' })
      for (const [key, entry] of recent) if (entry.expires <= Date.now()) recent.delete(key)
      // Deduplication is scoped to token and payload, not a client-supplied id alone.
      const key = createHash('sha256').update(JSON.stringify(value)).digest('hex')
      const cached = recent.get(key)
      if (cached) return respond(response, 200, cached.result)
      let delivery = pending.get(key)
      if (!delivery) {
        delivery = options.send(value)
        pending.set(key, delivery)
        void delivery
          .finally(() => {
            pending.delete(key)
          })
          .catch(() => {})
      }
      const result = await delivery
      if (recent.size >= 10_000) {
        const oldest = recent.keys().next().value
        if (oldest) recent.delete(oldest)
      }
      recent.set(key, { expires: Date.now() + 3_600_000, result })
      respond(response, 200, result)
    } finally {
      active--
    }
  }
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent)
        respond(response, 502, {
          error: 'Push delivery failed; check relay provider configuration',
        })
      else response.destroy()
    })
  })
  server.requestTimeout = 15_000
  server.headersTimeout = 10_000
  return server
}
