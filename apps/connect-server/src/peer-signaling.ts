import type { Server } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { WebSocket, WebSocketServer } from 'ws'
import { Schema } from 'effect'
import {
  decode,
  peerSignalSchema,
  peerRelayProviderSchema,
  peerRelayIdentitySchema,
  peerRelayProofSchema,
  peerRelayAdmissionPayload,
  type PeerRelay,
  type PeerRelayProvider,
} from '@dovo/protocol'
import type { PeerRelayIssuer } from './relay-credentials.js'
import type { PeerRelayAdmission } from './relay-admission.js'
import { approvedRelayInstallations } from './relay-admission.js'
import { clientAddress } from './client-address.js'
import { rateLimit } from './rate-limit.js'

const key = Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{64}$/)))
const helloSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('host'),
    room: key,
    key,
    clientKey: key,
    relayIdentity: Schema.optional(peerRelayIdentitySchema),
    relayAllowed: Schema.optional(Schema.Boolean),
    accountGrant: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal('client'),
    room: key,
    key,
    session: key,
    relay: Schema.optional(peerRelayProviderSchema),
  }),
])
const equal = (a: string, b: string) => timingSafeEqual(Buffer.from(a), Buffer.from(b))

/** Only bounded, short-lived ICE/SDP metadata crosses Connect. No HTTP proxy, TURN,
 * runtime credentials or application frames are accepted here. Peers authenticate the
 * complete SDP independently using the out-of-band pairing secret. */
export function attachPeerSignaling(
  server: Server,
  trustedProxies: readonly string[] = [],
  relayIssuers: Partial<Record<PeerRelayProvider, PeerRelayIssuer>> = {},
  relayAdmission?: PeerRelayAdmission,
  origin = 'https://connect.dovo.studio',
  accountAdmission?: (grant: string, identity: string) => boolean,
) {
  const ws = new WebSocketServer({
    noServer: true,
    maxPayload: 70 * 1024,
    perMessageDeflate: false,
  })
  const address = clientAddress(trustedProxies)
  const limit = rateLimit(Date.now)
  const perAddress = new Map<string, number>()
  const rooms = new Map<
    string,
    {
      host: WebSocket
      clients: Map<string, WebSocket>
      clientKey: string
      relayApproved: boolean
      relayAllowed: boolean
      admitted: Promise<void>
      relayIdentity?: string
      accountGrant?: string
    }
  >()
  const alive = new WeakSet<WebSocket>()
  const upgrade = (
    request: import('node:http').IncomingMessage,
    socket: import('node:stream').Duplex,
    head: Buffer,
  ) => {
    if (request.url !== '/v1/peer') {
      socket.destroy()
      return
    }
    const ip = address(request)
    try {
      limit(ip)
    } catch {
      socket.destroy()
      return
    }
    if (ws.clients.size >= 4096 || (perAddress.get(ip) ?? 0) >= 32) {
      socket.destroy()
      return
    }
    ws.handleUpgrade(request, socket, head, (client) => {
      perAddress.set(ip, (perAddress.get(ip) ?? 0) + 1)
      alive.add(client)
      client.on('pong', () => alive.add(client))
      let hello: typeof helloSchema.Type | undefined
      let messages = 0
      let window = Date.now()
      let sent = false
      let joining = false
      let relay: PeerRelay | undefined
      let admissionChallenge: string | undefined
      let finishAdmission: (() => void) | undefined
      const deadline = setTimeout(
        () => client.close(1008, 'Signaling authentication required'),
        5000,
      )
      deadline.unref()
      client.on('error', () => client.terminate())
      client.on('close', () => {
        clearTimeout(deadline)
        finishAdmission?.()
        const count = (perAddress.get(ip) ?? 1) - 1
        if (count) perAddress.set(ip, count)
        else perAddress.delete(ip)
        if (!hello) return
        const room = rooms.get(hello.room)
        if (hello.type === 'host' && room?.host === client) {
          rooms.delete(hello.room)
          for (const joined of room.clients.values()) joined.close(1012, 'Computer disconnected')
        } else if (hello.type === 'client' && room?.clients.get(hello.session) === client)
          room.clients.delete(hello.session)
      })
      client.on('message', (raw, binary) => {
        try {
          if (binary) throw new Error('Signaling is JSON only')
          if (Date.now() - window > 60000) {
            messages = 0
            window = Date.now()
          }
          if (++messages > 60) throw new Error('Signaling rate exceeded')
          const bytes = Array.isArray(raw)
            ? Buffer.concat(raw)
            : Buffer.from(raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw)
          const value: unknown = JSON.parse(bytes.toString())
          if (joining) throw new Error('Wait for signaling readiness')
          if (!hello) {
            const input = decode(helloSchema, value)
            const existing = rooms.get(input.room)
            if (input.type === 'host') {
              if (
                input.accountGrant &&
                (!input.relayIdentity ||
                  !accountAdmission?.(input.accountGrant, input.relayIdentity))
              )
                throw new Error('Internet access revoked')
              // A live host cannot be displaced, including by another account/device.
              if (existing || rooms.size >= 2048) throw new Error('Computer already connected')
              const admitted = new Promise<void>((resolve) => {
                finishAdmission = resolve
              })
              rooms.set(input.room, {
                admitted,
                host: client,
                clients: new Map(),
                clientKey: input.clientKey,
                relayApproved: false,
                relayAllowed: input.relayAllowed === true,
                relayIdentity: input.relayIdentity,
                accountGrant: input.accountGrant,
              })
            } else {
              if (
                !existing ||
                (existing.accountGrant &&
                  !accountAdmission?.(existing.accountGrant, existing.relayIdentity ?? '')) ||
                !equal(existing.clientKey, input.key) ||
                existing.clients.size >= 4 ||
                existing.clients.has(input.session)
              )
                throw new Error('Computer is unavailable')
              existing.clients.set(input.session, client)
              // This socket is only needed for one offer/answer, never application traffic.
              const expiry = setTimeout(() => client.close(1000, 'Signaling complete'), 45000)
              expiry.unref()
              client.once('close', () => clearTimeout(expiry))
            }
            hello = input
            if (
              input.type === 'host' &&
              input.relayIdentity &&
              relayAdmission &&
              Object.values(relayIssuers).some(Boolean)
            ) {
              admissionChallenge = randomBytes(32).toString('hex')
              client.send(
                JSON.stringify({ type: 'relay-challenge', challenge: admissionChallenge }),
              )
              return
            }
            if (input.type === 'host') finishAdmission?.()
            joining = true
            void (async () => {
              if (existing) await existing.admitted
              if (
                client.readyState !== WebSocket.OPEN ||
                (existing && rooms.get(input.room) !== existing)
              )
                return
              clearTimeout(deadline)
              const provider = input.type === 'client' ? input.relay : undefined
              const issue =
                provider && existing?.relayApproved && existing.relayAllowed
                  ? relayIssuers[provider]
                  : undefined
              if (issue) {
                try {
                  relay = await issue(input.room, ip, existing?.relayIdentity)
                } catch {
                  /* Direct ICE remains available during provider outages or quota limits. */
                }
              }
              joining = false
              if (client.readyState === WebSocket.OPEN)
                client.send(
                  JSON.stringify({
                    type: 'ready',
                    ...(relay ? { relay } : provider ? { relayUnavailable: provider } : {}),
                  }),
                )
            })()
            return
          }
          if (hello.type === 'host' && admissionChallenge) {
            const proof = decode(peerRelayProofSchema, value)
            const challenge = admissionChallenge
            admissionChallenge = undefined
            const room = rooms.get(hello.room)
            if (!room || room.host !== client || !hello.relayIdentity || !relayAdmission)
              throw new Error('Relay installation is unavailable')
            const admit =
              room.accountGrant && accountAdmission?.(room.accountGrant, hello.relayIdentity)
                ? approvedRelayInstallations([hello.relayIdentity])
                : relayAdmission
            room.relayApproved = admit(
              hello.relayIdentity,
              peerRelayAdmissionPayload(
                challenge,
                hello.room,
                hello.key,
                hello.clientKey,
                hello.relayAllowed === true,
                origin,
              ),
              proof.signature,
            )
            clearTimeout(deadline)
            client.send(JSON.stringify({ type: 'ready', relayApproved: room.relayApproved }))
            finishAdmission?.()
            return
          }
          const signal = decode(peerSignalSchema, value)
          const room = rooms.get(hello.room)
          if (!room) throw new Error('Computer is unavailable')
          if (hello.type === 'client') {
            if (sent || signal.role !== 'offer' || signal.session !== hello.session)
              throw new Error('Unexpected offer')
            if (signal.relay !== relay?.provider)
              throw new Error('Relay consent does not match offer')
            sent = true
            room.host.send(JSON.stringify({ type: 'offer', signal, ...(relay ? { relay } : {}) }))
          } else {
            if (signal.role !== 'answer') throw new Error('Unexpected answer')
            const target = room.clients.get(signal.session)
            if (!target || target.readyState !== WebSocket.OPEN) return
            target.send(JSON.stringify(signal))
            room.clients.delete(signal.session)
          }
        } catch {
          client.close(1008, 'Invalid or unavailable signaling session')
        }
      })
    })
  }
  server.on('upgrade', upgrade)
  const heartbeat = setInterval(() => {
    for (const client of ws.clients) {
      if (!alive.delete(client)) client.terminate()
      else client.ping()
    }
  }, 25000)
  heartbeat.unref()
  const revocations = setInterval(() => {
    for (const room of rooms.values())
      if (room.accountGrant && !accountAdmission?.(room.accountGrant, room.relayIdentity ?? ''))
        room.host.terminate()
  }, 1000)
  revocations.unref()
  server.once('close', () => {
    clearInterval(revocations)
    clearInterval(heartbeat)
    server.removeListener('upgrade', upgrade)
    for (const client of ws.clients) client.terminate()
    ws.close()
    rooms.clear()
  })
}
