import type { Server } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { WebSocket, WebSocketServer } from 'ws'
import { Schema } from 'effect'
import {
  decode,
  peerSignalSchema,
  peerIceSignalSchema,
  PEER_ICE_LIMIT,
  peerRelayProviderSchema,
  peerRelayIdentitySchema,
  peerRelayProofSchema,
  peerRelayAdmissionPayload,
  peerRelayResponseSchema,
  internetBoxSchema,
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
    trickle: Schema.optional(Schema.Boolean),
    room: key,
    key,
    clientKey: key,
    relayIdentity: Schema.optional(peerRelayIdentitySchema),
    relayAllowed: Schema.optional(Schema.Boolean),
    accountGrant: Schema.optional(Schema.String),
    customRelay: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    type: Schema.Literal('client'),
    trickle: Schema.optional(Schema.Boolean),
    room: key,
    key,
    session: key,
    relay: Schema.optional(peerRelayProviderSchema),
    customRelaySupported: Schema.optional(Schema.Boolean),
  }),
])
const equal = (a: string, b: string) => timingSafeEqual(Buffer.from(a), Buffer.from(b))
/** A phone may cancel or finish signaling while the computer is still gathering trickle
 * candidates on its shared host socket. Retired exchanges keep that exchange's identity and
 * ICE bookkeeping for a bounded time so late, correctly sequenced host frames are consumed
 * instead of being treated as abuse that closes every other pending negotiation. */
const RETIRED_EXCHANGE_LIMIT = 16
const RETIRED_EXCHANGE_TTL = 60000
type RetiredExchange = { answerSequence: number; answerEnded: boolean; expiresAt: number }
const retiredKey = (session: string, offer: string) => `${session}:${offer}`

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
      customRelay: boolean
      trickle: boolean
      exchanges: Map<
        string,
        {
          offer: string
          trickle: boolean
          answered: boolean
          offerSequence: number
          answerSequence: number
          offerEnded: boolean
          answerEnded: boolean
        }
      >
      pendingRelays: Map<string, (box?: typeof internetBoxSchema.Type) => void>
      retired: Map<string, RetiredExchange>
    }
  >()
  type Room = NonNullable<ReturnType<typeof rooms.get>>
  const retireExchange = (room: Room, session: string) => {
    const exchange = room.exchanges.get(session)
    room.exchanges.delete(session)
    // Only trickle exchanges carry host frames after the answer; nothing else is tolerated.
    if (!exchange?.trickle) return
    const now = Date.now()
    for (const [key, entry] of room.retired) if (entry.expiresAt <= now) room.retired.delete(key)
    while (room.retired.size >= RETIRED_EXCHANGE_LIMIT) {
      const oldest = room.retired.keys().next()
      if (oldest.done) break
      room.retired.delete(oldest.value)
    }
    room.retired.set(retiredKey(session, exchange.offer), {
      answerSequence: exchange.answerSequence,
      answerEnded: exchange.answerEnded,
      expiresAt: now + RETIRED_EXCHANGE_TTL,
    })
  }
  const retiredExchange = (room: Room, session: string, offer: string) => {
    const key = retiredKey(session, offer)
    const entry = room.retired.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= Date.now()) {
      room.retired.delete(key)
      return undefined
    }
    return { key, entry }
  }
  const authorized = (room: { accountGrant?: string; relayIdentity?: string }) =>
    !room.accountGrant ||
    (!!room.relayIdentity && !!accountAdmission?.(room.accountGrant, room.relayIdentity))
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
      let customRelay: typeof internetBoxSchema.Type | undefined
      let admissionChallenge: string | undefined
      let finishAdmission: (() => void) | undefined
      const deadline = setTimeout(
        () => client.close(1008, 'Signaling authentication required'),
        5000,
      )
      deadline.unref()
      // Check the live room and grant at every authorization boundary, including after
      // awaiting a relay provider. The periodic sweep is only idle-socket cleanup.
      const availableRoom = () => {
        const room = hello && rooms.get(hello.room)
        return hello &&
          room &&
          authorized(room) &&
          room.host.readyState === WebSocket.OPEN &&
          (hello.type === 'host'
            ? room.host === client
            : room.clients.get(hello.session) === client)
          ? room
          : undefined
      }
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
        } else if (hello.type === 'client' && room?.clients.get(hello.session) === client) {
          room.clients.delete(hello.session)
          retireExchange(room, hello.session)
          if (room.customRelay && room.host.readyState === WebSocket.OPEN)
            room.host.send(JSON.stringify({ type: 'relay-cancel', session: hello.session }))
          room.pendingRelays.get(hello.session)?.()
          room.pendingRelays.delete(hello.session)
        }
      })
      client.on('message', (raw, binary) => {
        try {
          if (binary) throw new Error('Signaling is JSON only')
          if (Date.now() - window > 60000) {
            messages = 0
            window = Date.now()
          }
          if (++messages > (hello?.type === 'host' ? 600 : 140))
            throw new Error('Signaling rate exceeded')
          const bytes = Array.isArray(raw)
            ? Buffer.concat(raw)
            : Buffer.from(raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw)
          const value: unknown = JSON.parse(bytes.toString())
          if (joining) throw new Error('Wait for signaling readiness')
          if (!hello) {
            const input = decode(helloSchema, value)
            const existing = rooms.get(input.room)
            if (input.type === 'host') {
              if (!authorized(input)) throw new Error('Internet access revoked')
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
                customRelay: input.customRelay === true,
                pendingRelays: new Map(),
                trickle: input.trickle === true,
                exchanges: new Map(),
                retired: new Map(),
              })
            } else {
              if (
                !existing ||
                !authorized(existing) ||
                !equal(existing.clientKey, input.key) ||
                existing.clients.size >= 4 ||
                existing.clients.has(input.session)
              )
                throw new Error('Computer is unavailable')
              existing.clients.set(input.session, client)
              // This socket is only needed for one offer/answer, never application traffic.
              // Its expiry or cancellation retires the exchange rather than forgetting it.
              const expiry = setTimeout(() => client.close(1000, 'Signaling complete'), 45000)
              expiry.unref()
              client.once('close', () => clearTimeout(expiry))
            }
            hello = input
            if (
              input.type === 'host' &&
              input.relayIdentity &&
              (input.accountGrant || relayAdmission) &&
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
              if (client.readyState !== WebSocket.OPEN) return
              if (!availableRoom()) {
                client.close(1008, 'Signaling access revoked')
                return
              }
              clearTimeout(deadline)
              const provider = input.type === 'client' ? input.relay : undefined
              if (
                input.type === 'client' &&
                input.customRelaySupported &&
                provider &&
                provider !== 'cloudflare' &&
                existing?.customRelay
              ) {
                customRelay = await new Promise<typeof internetBoxSchema.Type | undefined>(
                  (resolve) => {
                    const timeout = setTimeout(() => {
                      existing.pendingRelays.delete(input.session)
                      resolve(undefined)
                    }, 5000)
                    timeout.unref()
                    existing.pendingRelays.set(input.session, (box) => {
                      clearTimeout(timeout)
                      resolve(box)
                    })
                    existing.host.send(
                      JSON.stringify({ type: 'relay-request', session: input.session }),
                    )
                  },
                )
              }
              if (!availableRoom()) {
                client.close(1008, 'Signaling access revoked')
                return
              }
              const issue =
                !customRelay &&
                provider !== 'custom' &&
                provider &&
                existing?.relayApproved &&
                existing.relayAllowed
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
              if (client.readyState !== WebSocket.OPEN) return
              if (!availableRoom()) {
                client.close(1008, 'Signaling access revoked')
                return
              }
              client.send(
                JSON.stringify({
                  type: 'ready',
                  ...(input.type === 'client' && input.trickle && existing?.trickle
                    ? { trickle: true }
                    : {}),
                  ...(customRelay
                    ? { customRelay }
                    : relay
                      ? { relay }
                      : provider
                        ? { relayUnavailable: provider }
                        : {}),
                }),
              )
            })()
            return
          }
          if (hello.type === 'host' && admissionChallenge) {
            const proof = decode(peerRelayProofSchema, value)
            const challenge = admissionChallenge
            admissionChallenge = undefined
            const room = availableRoom()
            if (!room || room.host !== client || !hello.relayIdentity)
              throw new Error('Relay installation is unavailable')
            const admit = room.accountGrant
              ? approvedRelayInstallations([hello.relayIdentity])
              : relayAdmission
            if (!admit) throw new Error('Relay installation is unavailable')
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
          if (
            hello.type === 'host' &&
            value &&
            typeof value === 'object' &&
            'type' in value &&
            value.type === 'relay-response'
          ) {
            const response = decode(peerRelayResponseSchema, value)
            const room = availableRoom()
            if (!room) throw new Error('Computer is unavailable')
            room.pendingRelays.get(response.session)?.(response.box)
            room.pendingRelays.delete(response.session)
            return
          }
          if (value && typeof value === 'object' && 'type' in value && value.type === 'ice') {
            const signal = decode(peerIceSignalSchema, value)
            const room = availableRoom()
            if (!room) throw new Error('Unexpected ICE candidate')
            const exchange = room.exchanges.get(signal.session)
            if (hello.type === 'host' && (!exchange || exchange.offer !== signal.offer)) {
              // Late host frames for a retired exchange are consumed in strict order and
              // never forwarded; the phone's socket is gone. Anything else is still abuse.
              const retired = retiredExchange(room, signal.session, signal.offer)
              if (
                !retired ||
                signal.role !== 'answer' ||
                retired.entry.answerEnded ||
                signal.sequence !== retired.entry.answerSequence ||
                (signal.candidate && signal.sequence >= PEER_ICE_LIMIT)
              )
                throw new Error('Unexpected ICE candidate')
              retired.entry.answerSequence++
              retired.entry.answerEnded = signal.candidate === null
              if (retired.entry.answerEnded) room.retired.delete(retired.key)
              return
            }
            if (
              !exchange?.trickle ||
              signal.offer !== exchange.offer ||
              signal.role !== (hello.type === 'client' ? 'offer' : 'answer') ||
              (hello.type === 'client' && signal.session !== hello.session) ||
              (hello.type === 'host' && !exchange.answered)
            )
              throw new Error('Unexpected ICE candidate')
            const sequence = signal.role === 'offer' ? 'offerSequence' : 'answerSequence'
            const ended = signal.role === 'offer' ? 'offerEnded' : 'answerEnded'
            if (
              exchange[ended] ||
              signal.sequence !== exchange[sequence] ||
              (signal.candidate && signal.sequence >= PEER_ICE_LIMIT)
            )
              throw new Error('ICE candidate limit or sequence exceeded')
            exchange[sequence]++
            exchange[ended] = signal.candidate === null
            const target = hello.type === 'client' ? room.host : room.clients.get(signal.session)
            if (target?.readyState === WebSocket.OPEN) target.send(JSON.stringify(signal))
            return
          }
          const signal = decode(peerSignalSchema, value)
          const room = availableRoom()
          if (!room) throw new Error('Computer is unavailable')
          if (hello.type === 'client') {
            if (sent || signal.role !== 'offer' || signal.session !== hello.session)
              throw new Error('Unexpected offer')
            if (signal.relay !== (customRelay ? 'custom' : relay?.provider))
              throw new Error('Relay consent does not match offer')
            if (signal.trickle && (!hello.trickle || !room.trickle))
              throw new Error('Trickle ICE was not negotiated')
            sent = true
            room.exchanges.set(signal.session, {
              offer: signal.offer,
              trickle: signal.trickle === true,
              answered: false,
              offerSequence: 0,
              answerSequence: 0,
              offerEnded: false,
              answerEnded: false,
            })
            room.host.send(JSON.stringify({ type: 'offer', signal, ...(relay ? { relay } : {}) }))
          } else {
            if (signal.role !== 'answer') throw new Error('Unexpected answer')
            const target = room.clients.get(signal.session)
            const exchange = room.exchanges.get(signal.session)
            if (!target || target.readyState !== WebSocket.OPEN) {
              // The phone already left or is closing. Record a correctly bound answer so the
              // computer's trailing trickle frames are consumed instead of treated as abuse.
              if (
                exchange &&
                !exchange.answered &&
                exchange.offer === signal.offer &&
                !!signal.trickle === exchange.trickle
              )
                exchange.answered = true
              return
            }
            if (
              !exchange ||
              exchange.answered ||
              exchange.offer !== signal.offer ||
              !!signal.trickle !== exchange.trickle
            )
              throw new Error('Unexpected answer binding')
            exchange.answered = true
            target.send(JSON.stringify(signal))
            if (!exchange.trickle) {
              room.clients.delete(signal.session)
              room.exchanges.delete(signal.session)
            }
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
    for (const room of rooms.values()) if (!authorized(room)) room.host.terminate()
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
