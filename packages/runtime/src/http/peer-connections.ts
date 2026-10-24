import { randomBytes } from 'node:crypto'
import { connect, type Socket } from 'node:net'
import type Database from 'better-sqlite3'
import { WebSocket } from 'ws'
import type { RTCPeerConnection } from 'werift'
import { Schema } from 'effect'
import {
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
  createPeerIce,
  createPeerHeartbeat,
  peerCandidateCounts,
  selectedPeerRoute,
  type PeerSessionDiagnostics,
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
import type { RuntimeConnectionMode } from '@dovo/protocol'
import { HttpError } from '../errors.js'
import { RuntimeRelaySettings } from './relay-settings.js'
import { peerRelayServers } from './peer-ice-servers.js'

type Room = {
  config: PeerConfig
  accountGrant?: string
  deviceId?: string
  expiresAt?: number
  socket?: WebSocket
  retry?: ReturnType<typeof setTimeout>
  reconnects: number
  ready?: Promise<void>
  /** Each negotiated peer's teardown: pipes, loopback sockets, timers, then the ICE session. */
  peers: Map<RTCPeerConnection, () => void>
  ice: Map<string, ReturnType<typeof createPeerIce>>
  sessions: Set<string>
  customRelays: Map<string, PeerRelay>
  stopped: boolean
  online: boolean
  lastError: string | null
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
  private recent: PeerSessionDiagnostics[] = []
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
  /** Keep current tunnels alive so the client changing policy can receive confirmation.
   * New negotiations immediately use the saved mode; pairings and relay credentials survive. */
  setConnectionMode(mode: RuntimeConnectionMode) {
    if (mode === this.relay.connectionMode()) return this.relay.status()
    const status = this.relay.setConnectionMode(mode)
    for (const room of this.rooms.values()) {
      if (room.retry) clearTimeout(room.retry)
      room.retry = undefined
      const socket = room.socket
      room.socket = undefined
      room.ready = undefined
      room.online = false
      room.lastError = null
      room.customRelays.clear()
      socket?.terminate()
      if (mode !== 'lan') this.open(room)
    }
    return status
  }
  relayIdentity() {
    return { publicKey: this.identity.publicKey }
  }
  diagnostics() {
    const rooms = [...this.rooms.values()]
    return {
      signaling: {
        configured: rooms.length,
        online: rooms.filter((room) => room.online).length,
        reconnecting:
          this.relay.connectionMode() === 'lan' ? 0 : rooms.filter((room) => !room.online).length,
        lastError: rooms.find((room) => room.lastError)?.lastError ?? null,
      },
      active: rooms.reduce((count, room) => count + room.peers.size, 0),
      recent: this.recent.map((entry) => ({ ...entry })),
    }
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
      origin: this.internet.origin,
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
    if (this.relay.connectionMode() === 'lan')
      throw new HttpError(409, 'This computer allows LAN / VPN connections only')
    if (!this.port) throw new Error('Internet connections are not running on this computer')
    // At most one outstanding bootstrap invite per runtime.
    for (const [id, room] of this.rooms) if (!room.deviceId) this.remove(id, room)
    const config = { ...this.config(), ...(relay ? { relay } : {}) }
    const room = this.add(config, undefined, Date.parse(expiresAt))
    await room.ready
    return config
  }
  async enable(deviceId: string, relay?: PeerRelayProvider, accountGrant?: string) {
    if (this.relay.connectionMode() === 'lan')
      throw new HttpError(409, 'This computer allows LAN / VPN connections only')
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
    if (this.relay.connectionMode() === 'lan')
      throw new HttpError(409, 'This computer allows LAN / VPN connections only')
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
      ice: new Map(),
      customRelays: new Map(),
      stopped: false,
      reconnects: 0,
      online: false,
      lastError: null,
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
    if (!room.origin.active || room.socket || !this.port || this.relay.connectionMode() === 'lan')
      return
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
    room.online = false
    let readyAt: number | undefined
    let pingTimer: ReturnType<typeof setTimeout> | undefined
    let pongTimer: ReturnType<typeof setTimeout> | undefined
    let pingNonce: Buffer | undefined
    const ping = () => {
      pingTimer = setTimeout(() => {
        if (room.socket !== socket || socket.readyState !== WebSocket.OPEN) return
        pingNonce = randomBytes(8)
        pongTimer = setTimeout(() => {
          if (room.socket !== socket || room.stopped) return
          room.lastError = 'Dovo Connect stopped responding; reconnecting.'
          socket.terminate()
        }, 10000)
        pongTimer.unref()
        // RFC 6455 ping/pong works with existing brokers too. Monitor our own
        // connection rather than waiting up to two broker heartbeat intervals.
        socket.ping(pingNonce, undefined, (error) => {
          if (error && room.socket === socket) socket.terminate()
        })
      }, 5000)
      pingTimer.unref()
    }
    socket.on('pong', (value) => {
      if (!pingNonce?.equals(value) || room.socket !== socket) return
      pingNonce = undefined
      clearTimeout(pongTimer)
      pongTimer = undefined
      ping()
    })
    room.ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        room.lastError = 'Timed out contacting Dovo Connect.'
        reject(new Error('Could not reach Dovo Connect for internet pairing'))
        socket.terminate()
      }, 10000)
      timeout.unref()
      const config = room.config
      const host = {
        type: 'host',
        trickle: true,
        room: peerRoom(config),
        key: peerCapability(config, 'host'),
        clientKey: peerCapability(config, 'client'),
        ...(config.relay === 'dovo' ? { relayIdentity: this.identity.publicKey } : {}),
        ...(room.accountGrant ? { accountGrant: room.accountGrant } : {}),
        // The computer's consent; each phone still signs whether it uses the relay.
        relayAllowed: config.relay === 'dovo' && this.relay.connectionMode() === 'automatic',
        // This advertises protocol support. Settings consent and the requesting client's
        // relay preference must both permit issuance before any credentials are sealed.
        customRelay: this.relay.connectionMode() === 'automatic',
      }
      // Connect without issuers or admission answers `ready` at once. Otherwise it challenges
      // once, and the room is ready only on the `ready` that follows this installation's proof.
      let phase: 'hello' | 'proving' | 'ready' = 'hello'
      socket.once('open', () => socket.send(JSON.stringify(host)))
      socket.on('message', (raw) => {
        if (room.socket !== socket || this.relay.connectionMode() === 'lan') return
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
            room.lastError = null
            if (
              phase === 'proving' &&
              host.relayAllowed &&
              !(
                value &&
                typeof value === 'object' &&
                'relayApproved' in value &&
                value.relayApproved
              )
            ) {
              room.lastError = 'Relay access was not approved; direct connections remain available.'
              console.warn(
                'Dovo Connect has not approved this installation for relay access; using direct connections',
              )
            }
            phase = 'ready'
            room.online = true
            readyAt = Date.now()
            ping()
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
          if (
            type === 'ice' &&
            value &&
            typeof value === 'object' &&
            'session' in value &&
            typeof value.session === 'string'
          ) {
            const ice = room.ice.get(value.session)
            if (ice) ice.receive(value)
            return
          }
          const offer = decode(peerOfferSchema, value)
          const signal = offer.signal
          if (this.relay.connectionMode() !== 'automatic' && (offer.relay || signal.relay)) return
          const custom = room.customRelays.get(signal.session)
          room.customRelays.delete(signal.session)
          if (!acceptableOffer(room.config, offer, Date.now(), custom)) return
          if (room.sessions.has(signal.session) || room.peers.size >= 4) return
          if (room.sessions.size >= 128) room.sessions.delete(room.sessions.values().next().value!)
          room.sessions.add(signal.session)
          void this.accept(room, signal, signal.relay === 'custom' ? custom : offer.relay).catch(
            () => {
              room.ice.get(signal.session)?.stop()
              room.ice.delete(signal.session)
              console.error('Internet peer negotiation failed')
            },
          )
        } catch {
          room.lastError = 'Dovo Connect sent invalid signaling metadata.'
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
    socket.on('error', () => {
      if (room.socket !== socket) return
      room.lastError = 'Could not reach Dovo Connect. Check this computer’s internet connection.'
      socket.terminate()
    })
    socket.once('close', () => {
      clearTimeout(pingTimer)
      clearTimeout(pongTimer)
      pingNonce = undefined
      if (room.socket !== socket) return
      room.online = false
      room.lastError ??= 'Signaling disconnected; reconnecting to Dovo Connect.'
      room.customRelays.clear()
      room.socket = undefined
      room.ready = undefined
      if (
        room.origin.active &&
        room.socket === undefined &&
        this.relay.connectionMode() !== 'lan'
      ) {
        // Recover a healthy signaling session promptly. Repeated outages/flapping
        // back off with jitter; a briefly admitted socket must not reset that budget.
        if (readyAt !== undefined && Date.now() - readyAt >= 30000) room.reconnects = 0
        const delay = Math.min(30000, 500 * 2 ** Math.min(room.reconnects++, 6))
        room.retry = setTimeout(() => this.open(room), delay * (0.5 + Math.random() * 0.5))
        room.retry.unref()
      }
    })
  }
  private async accept(room: Room, signal: PeerSignal, relay?: PeerRelay) {
    if (!this.port || room.stopped || this.relay.connectionMode() === 'lan') return
    let iceFailed = false
    let failIce = () => {
      iceFailed = true
    }
    const ice = signal.trickle
      ? createPeerIce({
          config: room.config,
          session: signal.session,
          offer: signal.offer,
          role: 'answer',
          send: (value) => {
            if (!closed && room.socket?.readyState === WebSocket.OPEN)
              room.socket.send(JSON.stringify(value))
          },
          add: async (candidate) => {
            await pc.addIceCandidate(candidate)
            diagnostic.remoteCandidates = peerCandidateCounts(pc.remoteDescription?.sdp ?? '')
          },
          onError: () => failIce(),
        })
      : undefined
    if (ice) room.ice.set(signal.session, ice)
    const { RTCPeerConnection } = await import('werift')
    if (
      room.stopped ||
      iceFailed ||
      this.relay.connectionMode() === 'lan' ||
      (this.relay.connectionMode() !== 'automatic' && !!relay) ||
      room.peers.size >= 4 ||
      !room.socket ||
      room.socket.readyState !== WebSocket.OPEN
    ) {
      ice?.stop()
      room.ice.delete(signal.session)
      return
    }
    const pc = new RTCPeerConnection({
      iceServers: [
        ...PEER_STUN_URLS.map((urls) => ({ urls })),
        ...peerRelayServers(relay?.iceServers),
      ],
      iceTransportPolicy: 'all',
      iceUseIpv6: true,
      iceStunGatherTimeout: 3,
    })
    const diagnostic: PeerSessionDiagnostics = {
      startedAt: new Date().toISOString(),
      state: 'gathering',
      relay: relay?.provider ?? 'direct',
      route: null,
      localCandidates: peerCandidateCounts(''),
      remoteCandidates: peerCandidateCounts(signal.sdp),
      roundTripMs: null,
      setupMs: null,
      answerMs: null,
      trickle: signal.trickle === true,
      error: null,
    }
    this.recent.unshift(diagnostic)
    this.recent.length = Math.min(this.recent.length, 20)
    const pipes = new Set<ReturnType<typeof createPeerPipe>>()
    const sockets = new Set<Socket>()
    let readySeen = false
    let closed = false
    let disconnected: ReturnType<typeof setTimeout> | undefined
    let heartbeat: ReturnType<typeof createPeerHeartbeat> | undefined
    let statsTimer: ReturnType<typeof setTimeout> | undefined
    let readingStats = false
    let routeRevision = 0
    const close = (reason?: string) => {
      if (closed) return
      closed = true
      diagnostic.state = 'closed'
      ice?.stop()
      room.ice.delete(signal.session)
      diagnostic.error = reason ?? diagnostic.error
      clearTimeout(deadline)
      clearTimeout(statsTimer)
      heartbeat?.stop()
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
    failIce = () => close('Invalid authenticated ICE candidate.')
    const refreshRoute = async () => {
      if (closed || readingStats || pc.connectionState !== 'connected') return
      clearTimeout(statsTimer)
      readingStats = true
      const revision = routeRevision
      try {
        const route = selectedPeerRoute(await pc.getStats())
        if (closed || revision !== routeRevision || pc.connectionState !== 'connected') return
        diagnostic.route = route ?? null
        if (route !== 'direct' && relay && relay.expiresAt <= Date.now() + 60000)
          close('Relay credentials expired; a fresh connection is required.')
      } catch {
        if (closed || revision !== routeRevision || pc.connectionState !== 'connected') return
        diagnostic.route = null
        if (relay && relay.expiresAt <= Date.now() + 60000)
          close('Could not verify the route before relay credentials expired.')
      } finally {
        readingStats = false
        if (!closed && pc.connectionState === 'connected') {
          if (revision !== routeRevision) void refreshRoute()
          else statsTimer = setTimeout(() => void refreshRoute(), 5000)
        }
        statsTimer?.unref()
      }
    }
    room.peers.set(pc, close)
    const deadline = setTimeout(() => close(`Setup timed out while ${diagnostic.state}.`), 30000)
    deadline.unref()
    // Refresh expired TURN allocations through a fresh authenticated negotiation.
    const expiry = relay
      ? setTimeout(
          () => {
            if (pc.connectionState !== 'connected' && pc.connectionState !== 'disconnected')
              close('Relay credentials expired during setup.')
            else void refreshRoute()
          },
          Math.max(0, relay.expiresAt - Date.now() - 60000),
        )
      : undefined
    expiry?.unref()
    pc.connectionStateChange.subscribe((state) => {
      if (closed) return
      routeRevision++
      diagnostic.state = state
      if (state === 'disconnected') {
        clearTimeout(statsTimer)
        diagnostic.route = null
        disconnected ??= setTimeout(
          () => close('Network interruption did not recover within 10 seconds.'),
          PEER_DISCONNECT_GRACE_MS,
        )
        disconnected.unref()
      } else {
        if (state === 'connected') {
          if (disconnected) clearTimeout(disconnected)
          disconnected = undefined
          void refreshRoute()
        }
        if (state === 'failed' || state === 'closed') close(`Encrypted transport ${state}.`)
      }
    })
    pc.onDataChannel.subscribe((channel) => {
      if (channel.label === 'dovo-ready-v1') {
        if (readySeen || closed) {
          channel.close()
          return
        }
        readySeen = true
        heartbeat = createPeerHeartbeat({
          send: (value) => channel.send(value),
          connected: () => pc.connectionState === 'connected',
          onTimeout: () => close('Connection stopped responding to health checks.'),
          onRoundTrip: (milliseconds) => {
            diagnostic.roundTripMs = milliseconds
          },
        })
        channel.onMessage.subscribe((value) => {
          if (!heartbeat?.receive(typeof value === 'string' ? value : undefined))
            close('Invalid connection health message.')
        })
        channel.stateChange.subscribe((state) => {
          if (state === 'open') {
            clearTimeout(deadline)
            diagnostic.setupMs ??= Date.now() - Date.parse(diagnostic.startedAt)
            ice?.stop()
            room.ice.delete(signal.session)
            heartbeat?.announce()
          }
          if (state === 'closed') close('Connection health channel closed.')
        })
        if (channel.readyState === 'open') {
          clearTimeout(deadline)
          diagnostic.setupMs ??= Date.now() - Date.parse(diagnostic.startedAt)
          ice?.stop()
          room.ice.delete(signal.session)
          heartbeat.announce()
        }
        return
      }
      if (
        closed ||
        room.stopped ||
        pipes.size >= 32 ||
        channel.label !== (signal.pipeWindow === 64 ? 'dovo-tcp-v2' : 'dovo-tcp-v1') ||
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
        window: signal.pipeWindow,
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
      ice?.ready()
      if (ice)
        pc.onIceCandidate.subscribe((candidate) => {
          try {
            const value = candidate?.toJSON()
            ice.candidate(
              value
                ? {
                    candidate: value.candidate,
                    sdpMid: value.sdpMid ?? null,
                    sdpMLineIndex: value.sdpMLineIndex ?? null,
                  }
                : null,
            )
            diagnostic.localCandidates = peerCandidateCounts(pc.localDescription?.sdp ?? '')
          } catch {
            close('Could not send ICE candidates.')
          }
        })
      await pc.setLocalDescription(await pc.createAnswer(), { trickle: !!ice })
      if (closed || room.stopped || room.socket?.readyState !== WebSocket.OPEN) {
        close()
        return
      }
      const sdp = pc.localDescription?.sdp
      if (!sdp) throw new Error('No local ICE description')
      diagnostic.localCandidates = peerCandidateCounts(sdp)
      diagnostic.state = 'waiting for encrypted transport'
      diagnostic.answerMs = Date.now() - Date.parse(diagnostic.startedAt)
      room.socket.send(
        JSON.stringify(
          signPeerSignal(room.config, {
            session: signal.session,
            role: 'answer',
            offer: signal.offer,
            sdp,
            ...(ice ? { trickle: true as const } : {}),
            ...(signal.pipeWindow ? { pipeWindow: signal.pipeWindow } : {}),
            ...(relay ? { relay: relay.provider } : {}),
          }),
        ),
      )
      ice?.start()
    } catch (error) {
      close(`Negotiation failed while ${diagnostic.state}.`)
      throw error
    }
  }
  private remove(id: string, room: Room) {
    room.stopped = true
    for (const ice of room.ice.values()) ice.stop()
    room.ice.clear()
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
