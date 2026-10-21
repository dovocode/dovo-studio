import { randomBytes } from 'node:crypto'
import { connect, type Socket } from 'node:net'
import type Database from 'better-sqlite3'
import { WebSocket } from 'ws'
import type { RTCPeerConnection } from 'werift'
import { Schema } from 'effect'
import {
  ACCOUNT_DIRECTORY_URL,
  decode,
  peerConfigSchema,
  peerOfferSchema,
  peerRelayChallengeSchema,
  peerRoom,
  peerCapability,
  peerDigest,
  peerSocketUrl,
  signPeerSignal,
  verifyPeerSignal,
  validPeerRelay,
  PEER_STUN_URLS,
  PEER_DISCONNECT_GRACE_MS,
  createPeerPipe,
  peerRelayRequestSchema,
  sealCustomRelay,
  type PeerConfig,
  type PeerSignal,
  type PeerRelay,
  type PeerRelayProvider,
} from '@dovo/protocol'
import type { Devices } from '../auth/devices.js'
import { AccountInternet } from './account-internet.js'
import { PeerUpgrades } from './peer-upgrades.js'
import { peerRelayIdentity } from './peer-relay-identity.js'
import { RuntimeRelaySettings } from './relay-settings.js'

type Room = {
  config: PeerConfig
  accountGrant?: string
  deviceId?: string
  expiresAt?: number
  socket?: WebSocket
  retry?: ReturnType<typeof setTimeout>
  ready?: Promise<void>
  /** Each negotiated peer's teardown: pipes, loopback sockets, timers, then the ICE session. */
  peers: Map<RTCPeerConnection, () => void>
  sessions: Set<string>
  customRelays: Map<string, PeerRelay>
  stopped: boolean
  origin: PeerOrigin
}

/** Server-owned provenance of a tunneled connection. Device rooms carry only that device's
 * credential; a bootstrap room carries pairing and the device it claimed, nothing else. */
export interface PeerOrigin {
  readonly deviceId?: string
  /** Relay consent of a bootstrap invitation, inherited by the device room it creates. */
  readonly relay?: PeerRelayProvider
  readonly active: boolean
  /** Records the device a bootstrap tunnel claimed so it may exchange it for its own room. */
  claim(deviceId: string): void
  claimed(deviceId: string): boolean
  /** Keeps a bootstrap tunnel open while a pairing request made through it is pending. */
  extend(until: number): void
}

/** The broker supplies relay credentials, but only the phone's authenticated signal chooses
 * the provider. Relays must be short-lived and use only the room's pinned relay hosts. */
export function acceptableOffer(
  config: PeerConfig,
  offer: typeof peerOfferSchema.Type,
  now = Date.now(),
  customRelay?: PeerRelay,
) {
  const signal = offer.signal
  return (
    signal.role === 'offer' &&
    signal.offer === peerDigest(signal.sdp) &&
    verifyPeerSignal(config, signal) &&
    (offer.relay
      ? config.relay === signal.relay &&
        validPeerRelay(offer.relay, signal.relay, now, config.relayHosts)
      : signal.relay === undefined ||
        (signal.relay === 'custom' &&
          customRelay?.provider === 'custom' &&
          customRelay.expiresAt > now + 60_000))
  )
}

/** Outbound-only signaling and ICE. The tunnel destination is a dedicated ordinary
 * runtime listener; it cannot select arbitrary ports or use desktop-only routes. */
export class PeerConnections {
  readonly relay: RuntimeRelaySettings
  readonly internet: AccountInternet
  readonly upgrades: PeerUpgrades
  private rooms = new Map<string, Room>()
  /** Loopback source port of each tunneled socket, registered before any tunnel byte is sent. */
  private origins = new Map<number, { socket: Socket; origin: PeerOrigin }>()
  private port?: number
  private timer?: ReturnType<typeof setInterval>
  /** Operator-approved relay identity; its private key stays in this runtime's database. */
  private readonly identity: ReturnType<typeof peerRelayIdentity>
  constructor(
    private readonly db: Database.Database,
    private readonly devices: Devices,
  ) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS peer_connections (device_id TEXT PRIMARY KEY, config TEXT NOT NULL)',
    )
    this.identity = peerRelayIdentity(db)
    this.relay = new RuntimeRelaySettings(db)
    this.internet = new AccountInternet(db, devices, this, this.identity)
    this.upgrades = new PeerUpgrades(devices)
  }
  relayIdentity() {
    return { publicKey: this.identity.publicKey }
  }
  start(port: number) {
    this.port = port
    for (const row of this.db
      .prepare('SELECT device_id AS deviceId, config FROM peer_connections')
      .all()) {
      const saved = decode(Schema.Struct({ deviceId: Schema.String, config: Schema.String }), row)
      if (!this.internet.contains(saved.deviceId))
        this.add(decode(peerConfigSchema, JSON.parse(saved.config)), saved.deviceId)
    }
    this.internet.start()
    this.reap()
    this.timer = setInterval(() => this.reap(), 1000)
    this.timer.unref()
  }
  /** Resolves a connection accepted by the dedicated tunnel listener. Unknown connections, such
   * as another local process dialing that port, have no provenance and must be refused. */
  origin(socket: {
    remoteAddress?: string
    remotePort?: number
    localAddress?: string
    localPort?: number
  }) {
    if (socket.remoteAddress !== '127.0.0.1' || socket.remotePort === undefined) return undefined
    const entry = this.origins.get(socket.remotePort)
    return entry?.origin.active &&
      !entry.socket.destroyed &&
      entry.socket.localPort === socket.remotePort &&
      entry.socket.remotePort === socket.localPort &&
      entry.socket.localAddress === socket.remoteAddress &&
      entry.socket.remoteAddress === socket.localAddress
      ? entry.origin
      : undefined
  }
  private active() {
    return new Set(
      this.devices
        .list()
        .filter((device) => !device.revokedAt)
        .map((device) => device.id),
    )
  }
  private reap() {
    const active = this.active()
    for (const [id, room] of this.rooms) {
      for (const [session, relay] of room.customRelays)
        if (relay.expiresAt <= Date.now() + 60_000) room.customRelays.delete(session)
      if (room.deviceId && !this.internet.authorized(room.deviceId)) this.remove(id, room)
      if (
        (room.expiresAt && room.expiresAt <= Date.now()) ||
        (room.deviceId && !active.has(room.deviceId))
      ) {
        this.remove(id, room)
        if (room.deviceId)
          this.db.prepare('DELETE FROM peer_connections WHERE device_id=?').run(room.deviceId)
      }
    }
  }
  private config() {
    // Pinned into the QR and the phone's registry, so a compromised broker cannot redirect
    // either side to other TURN destinations. Omitted, both sides pin turn.dovo.studio.
    const hosts = process.env.DOVO_PEER_RELAY_HOSTS
    return decode(peerConfigSchema, {
      origin: process.env.DOVO_CONNECT_ORIGIN ?? ACCOUNT_DIRECTORY_URL,
      secret: randomBytes(32).toString('hex'),
      ...(hosts !== undefined
        ? {
            relayHosts: hosts
              .split(',')
              .map((host) => host.trim())
              .filter(Boolean),
          }
        : {}),
    })
  }
  async invitation(expiresAt: string, relay?: PeerRelayProvider) {
    if (!this.port) throw new Error('Internet connections are not running on this computer')
    // At most one outstanding bootstrap invite per runtime.
    for (const [id, room] of this.rooms) if (!room.deviceId) this.remove(id, room)
    const config = { ...this.config(), ...(relay ? { relay } : {}) }
    const room = this.add(config, undefined, Date.parse(expiresAt))
    await room.ready
    return config
  }
  async enable(deviceId: string, relay?: PeerRelayProvider, accountGrant?: string) {
    if (!this.port || deviceId === 'owner' || !this.active().has(deviceId))
      throw new Error('Enable internet access from a paired phone')
    let room = [...this.rooms.values()].find((room) => room.deviceId === deviceId)
    if (!room) {
      const saved = this.db
        .prepare('SELECT config FROM peer_connections WHERE device_id=?')
        .get(deviceId)
      const config = saved
        ? decode(
            peerConfigSchema,
            JSON.parse(decode(Schema.Struct({ config: Schema.String }), saved).config),
          )
        : { ...this.config(), ...(relay ? { relay } : {}) }
      this.db
        .prepare('INSERT OR REPLACE INTO peer_connections VALUES (?,?)')
        .run(deviceId, JSON.stringify(config))
      room = this.add(config, deviceId, undefined, accountGrant)
    }
    if (!room.ready) this.open(room)
    await room.ready
    // Revocation can land while signaling connects; never hand out a revoked device's room.
    if (room.stopped || !this.active().has(deviceId)) {
      this.disable(deviceId)
      throw new Error('This device is no longer paired')
    }
    return room.config
  }
  disable(deviceId: string) {
    for (const [id, room] of this.rooms) if (room.deviceId === deviceId) this.remove(id, room)
    this.db.prepare('DELETE FROM peer_connections WHERE device_id=?').run(deviceId)
  }
  enabled(deviceId: string) {
    return [...this.rooms.values()].some((room) => room.deviceId === deviceId && !room.stopped)
  }
  private add(config: PeerConfig, deviceId?: string, expiresAt?: number, accountGrant?: string) {
    const claims = new Set<string>()
    const internet = this.internet
    const room: Room = {
      config,
      accountGrant,
      deviceId,
      expiresAt,
      peers: new Map(),
      sessions: new Set(),
      customRelays: new Map(),
      stopped: false,
      origin: {
        deviceId,
        relay: deviceId ? undefined : config.relay,
        get active() {
          return (
            !room.stopped &&
            (!room.expiresAt || room.expiresAt > Date.now()) &&
            (!deviceId || internet.authorized(deviceId))
          )
        },
        claim: (id) => {
          if (!deviceId && !room.stopped) claims.add(id)
        },
        claimed: (id) => !deviceId && !room.stopped && claims.has(id),
        extend: (until) => {
          if (!deviceId && room.expiresAt && until > room.expiresAt) room.expiresAt = until
        },
      },
    }
    this.rooms.set(peerRoom(config), room)
    this.open(room)
    return room
  }
  private open(room: Room) {
    if (room.stopped || !this.port) return
    if (room.retry) {
      clearTimeout(room.retry)
      room.retry = undefined
    }
    const socket = new WebSocket(peerSocketUrl(room.config), {
      maxPayload: 70 * 1024,
      handshakeTimeout: 10000,
      followRedirects: false,
    })
    room.socket = socket
    room.ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Could not reach Dovo Connect for internet pairing'))
        socket.terminate()
      }, 10000)
      timeout.unref()
      const config = room.config
      const host = {
        type: 'host',
        room: peerRoom(config),
        key: peerCapability(config, 'host'),
        clientKey: peerCapability(config, 'client'),
        ...(config.relay === 'dovo' ? { relayIdentity: this.identity.publicKey } : {}),
        ...(room.accountGrant ? { accountGrant: room.accountGrant } : {}),
        // The computer's consent; each phone still signs whether it uses the relay.
        relayAllowed: config.relay === 'dovo',
        // This advertises protocol support. Settings consent and the requesting client's
        // relay preference must both permit issuance before any credentials are sealed.
        customRelay: true,
      }
      // Connect without issuers or admission answers `ready` at once. Otherwise it challenges
      // once, and the room is ready only on the `ready` that follows this installation's proof.
      let phase: 'hello' | 'proving' | 'ready' = 'hello'
      socket.once('open', () => socket.send(JSON.stringify(host)))
      socket.on('message', (raw) => {
        try {
          const bytes = Array.isArray(raw)
            ? Buffer.concat(raw)
            : Buffer.from(raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw)
          const value: unknown = JSON.parse(bytes.toString())
          const type =
            value && typeof value === 'object' && 'type' in value ? value.type : undefined
          if (type === 'relay-challenge') {
            if (phase !== 'hello' || !host.relayAllowed)
              throw new Error('Unexpected relay challenge')
            const { challenge } = decode(peerRelayChallengeSchema, value)
            phase = 'proving'
            socket.send(
              JSON.stringify(
                this.identity.prove(
                  challenge,
                  host.room,
                  host.key,
                  host.clientKey,
                  host.relayAllowed,
                  config.origin,
                ),
              ),
            )
            return
          }
          if (type === 'ready') {
            if (phase === 'ready') throw new Error('Unexpected ready')
            if (
              phase === 'proving' &&
              host.relayAllowed &&
              !(
                value &&
                typeof value === 'object' &&
                'relayApproved' in value &&
                value.relayApproved
              )
            )
              console.warn(
                'Dovo Connect has not approved this installation for relay access; using direct connections',
              )
            phase = 'ready'
            clearTimeout(timeout)
            resolve()
            return
          }
          if (phase !== 'ready') throw new Error('Offer before admission')
          if (type === 'relay-request' || type === 'relay-cancel') {
            const { session } = decode(peerRelayRequestSchema, value)
            if (type === 'relay-cancel') {
              room.customRelays.delete(session)
              return
            }
            if (!host.customRelay || room.customRelays.size >= 4) {
              socket.send(JSON.stringify({ type: 'relay-response', session }))
              return
            }
            const relay = this.relay.issue()
            if (relay) room.customRelays.set(session, relay)
            socket.send(
              JSON.stringify({
                type: 'relay-response',
                session,
                ...(relay ? { box: sealCustomRelay(config, session, relay, randomBytes(24)) } : {}),
              }),
            )
            return
          }
          const offer = decode(peerOfferSchema, value)
          const signal = offer.signal
          const custom = room.customRelays.get(signal.session)
          room.customRelays.delete(signal.session)
          if (!acceptableOffer(room.config, offer, Date.now(), custom)) return
          if (room.sessions.has(signal.session) || room.peers.size >= 4) return
          if (room.sessions.size >= 128) room.sessions.delete(room.sessions.values().next().value!)
          room.sessions.add(signal.session)
          void this.accept(room, signal, signal.relay === 'custom' ? custom : offer.relay).catch(
            () => console.error('Internet peer negotiation failed'),
          )
        } catch {
          socket.close(1008, 'Invalid signaling metadata')
        }
      })
      socket.once('close', () => {
        clearTimeout(timeout)
        reject(new Error('Dovo Connect signaling disconnected'))
      })
    })
    // Background reconnects do not produce unhandled rejections; callers still receive
    // the original failure when they explicitly request a QR code or enable access.
    void room.ready.catch(() => {})
    socket.on('error', () => socket.terminate())
    socket.once('close', () => {
      if (room.socket === socket) {
        room.customRelays.clear()
        room.socket = undefined
        room.ready = undefined
      }
      if (!room.stopped) {
        room.retry = setTimeout(() => this.open(room), 5000 + Math.random() * 5000)
        room.retry.unref()
      }
    })
  }
  private async accept(room: Room, signal: PeerSignal, relay?: PeerRelay) {
    if (!this.port || room.stopped) return
    const { RTCPeerConnection } = await import('werift')
    if (
      room.stopped ||
      room.peers.size >= 4 ||
      !room.socket ||
      room.socket.readyState !== WebSocket.OPEN
    )
      return
    const pc = new RTCPeerConnection({
      iceServers: [
        ...PEER_STUN_URLS.map((urls) => ({ urls })),
        ...(relay?.iceServers.map((server) => ({
          ...server,
          urls: [...server.urls].sort(
            (a, b) =>
              Number(b.startsWith('turns:')) * 2 +
              Number(b.includes(':443?')) -
              (Number(a.startsWith('turns:')) * 2 + Number(a.includes(':443?'))),
          ),
        })) ?? []),
      ],
      iceTransportPolicy: 'all',
      iceUseIpv6: true,
      iceStunGatherTimeout: 3,
    })
    const pipes = new Set<ReturnType<typeof createPeerPipe>>()
    const sockets = new Set<Socket>()
    let readySeen = false
    let closed = false
    let disconnected: ReturnType<typeof setTimeout> | undefined
    const close = () => {
      if (closed) return
      closed = true
      clearTimeout(deadline)
      if (expiry) clearTimeout(expiry)
      if (disconnected) clearTimeout(disconnected)
      for (const pipe of pipes) pipe.stop()
      pipes.clear()
      // Destroying the loopback side ends HTTP keep-alive sockets and upgraded WebSockets on
      // the runtime listener even if the data channel never reports its closure.
      for (const socket of sockets) socket.destroy()
      sockets.clear()
      room.peers.delete(pc)
      void pc.close().catch((error: unknown) => console.error('Internet peer close failed:', error))
    }
    room.peers.set(pc, close)
    const deadline = setTimeout(close, 30000)
    deadline.unref()
    // Refresh expired TURN allocations through a fresh authenticated negotiation.
    const expiry = relay
      ? setTimeout(close, Math.max(0, relay.expiresAt - Date.now() - 60000))
      : undefined
    expiry?.unref()
    pc.connectionStateChange.subscribe((state) => {
      if (closed) return
      if (state === 'connected') clearTimeout(deadline)
      if (state === 'disconnected') {
        disconnected ??= setTimeout(close, PEER_DISCONNECT_GRACE_MS)
        disconnected.unref()
      } else {
        if (state === 'connected') {
          if (disconnected) clearTimeout(disconnected)
          disconnected = undefined
        }
        if (state === 'failed' || state === 'closed') close()
      }
    })
    pc.onDataChannel.subscribe((channel) => {
      if (channel.label === 'dovo-ready-v1') {
        if (readySeen || closed) {
          channel.close()
          return
        }
        readySeen = true
        channel.onMessage.subscribe(() => channel.close())
        channel.stateChange.subscribe((state) => {
          if (state === 'closed') close()
        })
        return
      }
      if (
        closed ||
        room.stopped ||
        pipes.size >= 32 ||
        channel.label !== 'dovo-tcp-v1' ||
        !channel.ordered ||
        channel.maxRetransmits !== null ||
        channel.maxPacketLifeTime !== null
      ) {
        channel.close()
        return
      }
      const socket = connect({ host: '127.0.0.1', port: this.port!, allowHalfOpen: true })
      socket.setNoDelay(true)
      sockets.add(socket)
      // Registered before the pipe can queue a write: Node flushes pending writes from a later
      // 'connect' listener, so the listener can never parse a request without provenance.
      let source: number | undefined
      socket.once('connect', () => {
        if (closed || room.stopped || socket.localPort === undefined) {
          socket.destroy()
          return
        }
        source = socket.localPort
        this.origins.set(source, { socket, origin: room.origin })
      })
      socket.once('close', () => {
        sockets.delete(socket)
        if (source !== undefined && this.origins.get(source)?.socket === socket)
          this.origins.delete(source)
      })
      const pipe = createPeerPipe({
        stream: {
          onData: (f) => {
            socket.on('data', f)
          },
          onEnd: (f) => {
            socket.on('end', f)
          },
          onClose: (f) => {
            socket.on('close', f)
          },
          onError: (f) => {
            socket.on('error', f)
          },
          write: (bytes, cb) => {
            socket.write(bytes, cb)
          },
          pause: () => {
            socket.pause()
          },
          resume: () => {
            socket.resume()
          },
          end: () => {
            socket.end()
          },
          destroy: () => {
            socket.destroy()
          },
        },
        send: (value) => channel.send(typeof value === 'string' ? value : Buffer.from(value)),
        close: () => channel.close(),
      })
      pipes.add(pipe)
      channel.onMessage.subscribe((value) => pipe.receive(value))
      channel.stateChange.subscribe((state) => {
        if (state === 'open') pipe.ready()
        if (state === 'closed') {
          pipes.delete(pipe)
          pipe.stop()
        }
      })
      if (channel.readyState === 'open') pipe.ready()
    })
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp })
      await pc.setLocalDescription(await pc.createAnswer())
      if (closed || room.stopped || room.socket?.readyState !== WebSocket.OPEN) {
        close()
        return
      }
      const sdp = pc.localDescription?.sdp
      if (!sdp) throw new Error('No local ICE description')
      room.socket.send(
        JSON.stringify(
          signPeerSignal(room.config, {
            session: signal.session,
            role: 'answer',
            offer: signal.offer,
            sdp,
            ...(relay ? { relay: relay.provider } : {}),
          }),
        ),
      )
    } catch (error) {
      close()
      throw error
    }
  }
  private remove(id: string, room: Room) {
    room.stopped = true
    if (room.retry) clearTimeout(room.retry)
    room.retry = undefined
    room.socket?.terminate()
    for (const close of [...room.peers.values()]) close()
    if (this.rooms.get(id) === room) this.rooms.delete(id)
  }
  async dispose() {
    this.internet.stop()
    if (this.timer) clearInterval(this.timer)
    const peers = [...this.rooms.values()].flatMap((room) => [...room.peers.keys()])
    for (const [id, room] of this.rooms) this.remove(id, room)
    await Promise.all(peers.map((pc) => pc.close()))
    this.port = undefined
  }
}
