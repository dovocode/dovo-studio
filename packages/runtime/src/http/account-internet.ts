import { randomBytes, createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import {
  ACCOUNT_DIRECTORY_URL,
  decode,
  internetPublicKey,
  internetBytes,
  internetBoxSchema,
  internetRegistrationPayload,
  internetHostSchema,
  sealInternet,
  peerAddress,
  peerConfigSchema,
  peerRelaySchema,
  type PeerConfig,
  type InternetRegistration,
} from '@dovo/protocol'
import { HttpError } from '../errors.js'
import type { Devices } from '../auth/devices.js'
import type { PeerConnections } from './peer-connections.js'
import type { peerRelayIdentity } from './peer-relay-identity.js'
const inboxSchema = Schema.Struct({
  organizationRelay: Schema.optional(
    Schema.Struct({
      name: Schema.String,
      relay: Schema.optional(peerRelaySchema),
      unavailable: Schema.optional(Schema.Literal(true)),
    }),
  ),
  active: Schema.Array(Schema.String),
  requests: Schema.Array(
    Schema.Struct({ id: Schema.String, publicKey: Schema.String, session: Schema.String }),
  ),
})
const stateSchema = Schema.Struct({
  grant: Schema.String,
  runtimeId: Schema.String,
  name: Schema.String,
})

/** Local owner consent plus account authorization. Account device credentials work only in
 * their own internet room, and rooms lose authorization when the broker lease expires. */
export class AccountInternet {
  private state?: typeof stateSchema.Type
  private timer?: ReturnType<typeof setTimeout>
  private controllers = new Set<AbortController>()
  private provisioning?: Promise<void>
  private polling = new Set<Promise<void>>()
  private generation = 0
  private lease = 0
  private activeRequests = new Set<string>()
  private running = false
  private enabling = false
  private setups = new Map<
    string,
    { id: string; session: string; registration: InternetRegistration; generation: number }
  >()
  private error = ''
  private readonly privateKey: Uint8Array
  readonly publicKey: string
  get origin(): string {
    const row = decode(
      Schema.Struct({ origin: Schema.String }),
      this.db.prepare('SELECT origin FROM account_service_settings WHERE id=1').get(),
    )
    return row.origin
  }
  private setOrigin(origin?: string) {
    if (origin === undefined || origin === this.origin) return
    decode(peerConfigSchema.fields.origin, origin)
    if (this.state || this.enabling || this.setups.size)
      throw new HttpError(
        409,
        'Disable Dovo Connect and finish pending setup before changing its URL',
      )
    this.db.prepare('UPDATE account_service_settings SET origin=? WHERE id=1').run(origin)
  }
  constructor(
    private readonly db: Database.Database,
    private readonly devices: Devices,
    private readonly peers: PeerConnections,
    private readonly identity: ReturnType<typeof peerRelayIdentity>,
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS account_internet(id INTEGER PRIMARY KEY CHECK(id=1),secret TEXT NOT NULL,state TEXT);
      CREATE TABLE IF NOT EXISTS account_service_settings(id INTEGER PRIMARY KEY CHECK(id=1),origin TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS account_internet_devices(request TEXT PRIMARY KEY,device TEXT NOT NULL,answer TEXT NOT NULL,session TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS account_internet_blocks(session TEXT PRIMARY KEY);`)
    db.prepare('INSERT OR IGNORE INTO account_service_settings VALUES(1,?)').run(
      process.env.DOVO_CONNECT_ORIGIN ?? ACCOUNT_DIRECTORY_URL,
    )
    let row = db.prepare('SELECT secret,state FROM account_internet WHERE id=1').get()
    if (!row) {
      db.prepare('INSERT INTO account_internet VALUES(1,?,NULL)').run(
        randomBytes(32).toString('hex'),
      )
      row = db.prepare('SELECT secret,state FROM account_internet WHERE id=1').get()
    }
    const saved = decode(
      Schema.Struct({ secret: Schema.String, state: Schema.NullOr(Schema.String) }),
      row,
    )
    this.privateKey = internetBytes(saved.secret)
    this.publicKey = internetPublicKey(this.privateKey)
    for (const item of db
      .prepare("SELECT device FROM account_internet_devices WHERE answer='{}'")
      .all()) {
      const { device } = decode(Schema.Struct({ device: Schema.String }), item)
      devices.revoke(device)
      db.prepare('DELETE FROM peer_connections WHERE device_id=?').run(device)
    }
    db.prepare("DELETE FROM account_internet_devices WHERE answer='{}'").run()
    if (saved.state) this.state = decode(stateSchema, JSON.parse(saved.state))
  }
  status() {
    return {
      enabled: !!this.state,
      connected: !!this.state && this.lease > Date.now(),
      error: this.error,
      origin: this.origin,
    }
  }
  contains(deviceId: string) {
    return !!this.db
      .prepare('SELECT request FROM account_internet_devices WHERE device=?')
      .get(deviceId)
  }
  authorized(deviceId: string) {
    return !this.contains(deviceId) || (!!this.state && this.lease > Date.now())
  }
  revoke(deviceId: string) {
    const row = this.db
      .prepare('SELECT session FROM account_internet_devices WHERE device=?')
      .get(deviceId)
    if (row)
      this.db
        .prepare('INSERT OR IGNORE INTO account_internet_blocks VALUES(?)')
        .run(decode(Schema.Struct({ session: Schema.String }), row).session)
  }
  start() {
    this.running = true
    if (this.state) void this.poll()
  }
  prepareSetup(
    deviceId: string,
    session: string,
    runtimeId: string,
    name: string,
    origin?: string,
  ) {
    if (!this.running) throw new HttpError(409, 'Internet connections are not running')
    if (this.state || this.enabling)
      throw new HttpError(409, 'Dovo Connect is already enabled or being configured')
    for (const [device, setup] of this.setups)
      if (Date.now() - setup.registration.timestamp >= 60000) this.setups.delete(device)
    this.setOrigin(origin)
    const previous = this.setups.get(deviceId)
    if (previous?.session === session)
      return { id: previous.id, registration: previous.registration }
    if (this.setups.size)
      throw new HttpError(409, 'Dovo Connect setup is already pending. Try again in one minute.')
    const registration = {
      id: runtimeId,
      name,
      identity: this.identity.publicKey,
      publicKey: this.publicKey,
      timestamp: Date.now(),
    }
    const setup = {
      id: randomUUID(),
      session,
      generation: this.generation,
      registration: {
        ...registration,
        signature: this.identity.signRegistration(
          internetRegistrationPayload(this.origin, session, registration),
        ),
      },
    }
    this.setups.set(deviceId, setup)
    return { id: setup.id, registration: setup.registration }
  }
  async completeSetup(deviceId: string, id: string, grant: string, validate: () => void) {
    const setup = this.setups.get(deviceId)
    if (!setup || setup.id !== id || Date.now() - setup.registration.timestamp >= 60000)
      throw new HttpError(404, 'Dovo Connect setup expired. Confirm setup again.')
    if (!this.running || setup.generation !== this.generation || this.state || this.enabling)
      throw new HttpError(409, 'Dovo Connect setup changed. Refresh this computer.')
    this.setups.delete(deviceId)
    this.enabling = true
    try {
      const { host } = decode(
        Schema.Struct({ host: Schema.optional(internetHostSchema) }),
        await this.request('/v1/internet/host', grant),
      )
      if (!host)
        throw new HttpError(
          502,
          'Update the Dovo Connect service to enable setup from paired devices',
        )
      if (
        host.id !== setup.registration.id ||
        host.identity !== this.identity.publicKey ||
        host.publicKey !== this.publicKey ||
        host.session !== setup.session
      )
        throw new HttpError(403, 'Account grant belongs to a different installation or session')
      validate()
      if (
        !this.running ||
        setup.generation !== this.generation ||
        Date.now() - setup.registration.timestamp >= 60000
      )
        throw new HttpError(409, 'Dovo Connect setup was cancelled')
      this.saveGrant(grant, setup.registration.id, setup.registration.name)
      return this.status()
    } finally {
      this.enabling = false
    }
  }
  private saveGrant(grant: string, runtimeId: string, name: string) {
    this.state = { grant, runtimeId, name }
    this.db
      .prepare('UPDATE account_internet SET state=? WHERE id=1')
      .run(JSON.stringify(this.state))
    this.setups.clear()
    this.error = ''
    void this.poll()
  }
  async enable(token: string, runtimeId: string, name: string, origin?: string) {
    if (!this.running) throw new Error('Internet connections are not running')
    if (this.state || this.enabling)
      throw new HttpError(
        409,
        'Dovo Connect is already enabled. Disable it before changing accounts or URLs.',
      )
    this.setOrigin(origin)
    this.enabling = true
    try {
      const generation = this.generation
      const registration = {
        id: runtimeId,
        name,
        identity: this.identity.publicKey,
        publicKey: this.publicKey,
        timestamp: Date.now(),
      }
      const sessionHash = createHash('sha256').update(token).digest('base64url')
      const result = decode(
        Schema.Struct({ grant: Schema.String }),
        await this.request('/v1/internet/hosts', token, 'PUT', {
          ...registration,
          signature: this.identity.signRegistration(
            internetRegistrationPayload(this.origin, sessionHash, registration),
          ),
        }),
      )
      if (!this.running || generation !== this.generation) {
        await this.request('/v1/internet/host', result.grant, 'DELETE')
        throw new Error('Internet setup was cancelled')
      }
      this.saveGrant(result.grant, runtimeId, name)
      return this.status()
    } finally {
      this.enabling = false
    }
  }
  async disable() {
    const grant = this.state?.grant
    const wasRunning = this.running
    this.stop()
    const generation = this.generation
    this.running = wasRunning
    this.state = undefined
    this.db.prepare('UPDATE account_internet SET state=NULL WHERE id=1').run()
    this.removeExcept(new Set())
    this.error = ''
    // Local revocation is immediate even if Connect cannot be reached. A stale broker entry
    // cannot answer requests and is marked offline when its short lease expires.
    if (grant)
      await this.request('/v1/internet/host', grant, 'DELETE').catch(() => {
        if (generation !== this.generation) return
        this.error =
          'Disabled locally. Unlink the offline computer from your account to remove its directory entry.'
      })
    return this.status()
  }
  private removeExcept(active: Set<string>) {
    for (const row of this.db
      .prepare('SELECT request,device FROM account_internet_devices')
      .all()) {
      const item = decode(Schema.Struct({ request: Schema.String, device: Schema.String }), row)
      if (active.has(item.request)) continue
      this.peers.disable(item.device)
      this.db.prepare('DELETE FROM account_internet_devices WHERE request=?').run(item.request)
      this.devices.revoke(item.device)
    }
  }
  private poll() {
    const pending = this.refresh().finally(() => this.polling.delete(pending))
    this.polling.add(pending)
    return pending
  }
  private async refresh() {
    if (!this.running || !this.state) return
    if (this.timer) clearTimeout(this.timer)
    const generation = this.generation,
      state = this.state
    try {
      const inbox = decode(inboxSchema, await this.request('/v1/internet/host', state.grant))
      if (generation !== this.generation) return
      if (
        inbox.organizationRelay?.relay &&
        (inbox.organizationRelay.relay.provider !== 'custom' ||
          inbox.organizationRelay.relay.expiresAt <= Date.now() + 60_000 ||
          inbox.organizationRelay.relay.expiresAt > Date.now() + 600_000)
      )
        throw new Error('Invalid organization relay policy')
      this.lease = Date.now() + 12000
      this.peers.relay.setOrganization(
        inbox.organizationRelay ? { ...inbox.organizationRelay, lease: this.lease } : undefined,
      )
      this.error = ''
      this.activeRequests = new Set(inbox.active)
      this.removeExcept(this.activeRequests)
      // Authentication has its own cadence: signaling setup and broker writes must never
      // consume the short authorization lease. Keep one pass even across disable/re-enable:
      // an old generation must finish its device cleanup before its replacement provisions.
      if (!this.provisioning) {
        const pending = this.provision(inbox, state, generation)
          .catch((error: unknown) => this.failed(error, generation))
          .finally(() => {
            if (this.provisioning === pending) this.provisioning = undefined
          })
        this.provisioning = pending
      }
    } catch (error) {
      await this.failed(error, generation)
    } finally {
      if (this.running && this.state && generation === this.generation) {
        this.timer = setTimeout(() => void this.poll(), 3000)
        this.timer.unref()
      }
    }
  }
  private async failed(error: unknown, generation: number) {
    if (generation !== this.generation) return
    this.error =
      'Dovo Connect is unavailable. Internet access pauses when its authorization lease expires.'
    if (error instanceof InternetAuthError) {
      await this.disable()
      this.error = 'Account access was revoked. Sign in and enable Dovo Connect again.'
    }
  }
  private async provision(
    inbox: typeof inboxSchema.Type,
    state: typeof stateSchema.Type,
    generation: number,
  ) {
    const blocked = new Set(
      this.db
        .prepare('SELECT session FROM account_internet_blocks')
        .all()
        .map((row) => decode(Schema.Struct({ session: Schema.String }), row).session),
    )
    for (const session of blocked) {
      await this.request('/v1/internet/host/block', state.grant, 'POST', { session })
      if (generation !== this.generation) return
      this.db.prepare('DELETE FROM account_internet_blocks WHERE session=?').run(session)
    }
    if (this.peers.relay.connectionMode() === 'lan') return
    for (const request of inbox.requests) {
      if (generation !== this.generation) return
      if (!this.activeRequests.has(request.id) || this.lease <= Date.now()) continue
      if (
        blocked.has(request.session) ||
        this.db
          .prepare('SELECT session FROM account_internet_blocks WHERE session=?')
          .get(request.session)
      )
        continue
      const previous = this.db
        .prepare('SELECT device,answer FROM account_internet_devices WHERE request=?')
        .get(request.id)
      let box: typeof internetBoxSchema.Type
      if (previous)
        box = decode(
          internetBoxSchema,
          JSON.parse(decode(Schema.Struct({ answer: Schema.String }), previous).answer),
        )
      else {
        const token = randomBytes(32).toString('base64url')
        const device = this.devices.add('Dovo Connect', token)
        // Store provenance before creating the room, so this token is never valid over LAN.
        this.db
          .prepare('INSERT INTO account_internet_devices VALUES(?,?,?,?)')
          .run(request.id, device, '{}', request.session)
        try {
          const peer: PeerConfig = await this.peers.enable(device, 'dovo', state.grant)
          if (
            generation !== this.generation ||
            !this.authorized(device) ||
            !this.db
              .prepare('SELECT request FROM account_internet_devices WHERE request=? AND device=?')
              .get(request.id, device)
          ) {
            this.peers.disable(device)
            this.db
              .prepare('DELETE FROM account_internet_devices WHERE request=? AND device=?')
              .run(request.id, device)
            this.devices.revoke(device)
            return
          }
          box = sealInternet(
            {
              requestId: request.id,
              runtimeId: state.runtimeId,
              connection: { address: peerAddress(peer), token, runtimeId: state.runtimeId, peer },
            },
            request.publicKey,
            this.privateKey,
            randomBytes(24),
          )
          this.db
            .prepare('UPDATE account_internet_devices SET answer=? WHERE request=?')
            .run(JSON.stringify(box), request.id)
        } catch (error) {
          this.peers.disable(device)
          this.db
            .prepare('DELETE FROM account_internet_devices WHERE request=? AND device=?')
            .run(request.id, device)
          this.devices.revoke(device)
          throw error
        }
      }
      if (generation !== this.generation || this.lease <= Date.now()) return
      if (
        !this.db
          .prepare('SELECT request FROM account_internet_devices WHERE request=?')
          .get(request.id)
      )
        continue
      await this.request('/v1/internet/host', state.grant, 'POST', { id: request.id, box })
    }
    if (generation !== this.generation) return
    for (const row of this.db.prepare('SELECT device FROM account_internet_devices').all()) {
      const { device } = decode(Schema.Struct({ device: Schema.String }), row)
      if (generation !== this.generation || this.lease <= Date.now()) return
      await this.peers.enable(device, 'dovo', state.grant)
    }
  }
  private async request(path: string, token: string, method = 'GET', body?: unknown) {
    // Optional Connect configuration must not affect ordinary LAN/VPN startup.
    // Validate its HTTPS (or loopback test) origin before sending any credential.
    decode(peerConfigSchema.fields.origin, this.origin)
    const controller = new AbortController()
    this.controllers.add(controller)
    const timer = setTimeout(() => controller.abort(), 5000)
    try {
      const response = await fetch(this.origin + path, {
        method,
        redirect: 'error',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      })
      if (response.status === 401) throw new InternetAuthError()
      if (!response.ok) throw new Error('Dovo Connect could not complete the request')
      return (await response.json()) as unknown
    } finally {
      clearTimeout(timer)
      this.controllers.delete(controller)
    }
  }
  /** Stop admission synchronously. Peer disposal then closes rooms to release pending enable()
   * calls and awaits drain() before the runtime may close SQLite. */
  stop() {
    this.peers.relay.setOrganization(undefined)
    this.running = false
    this.generation++
    this.setups.clear()
    this.lease = 0
    this.activeRequests.clear()
    for (const controller of this.controllers) controller.abort()
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }
  async drain() {
    const pending = [...this.polling]
    if (this.provisioning) pending.push(this.provisioning)
    // Observe every owned continuation even if another one fails during shutdown.
    const settled = await Promise.allSettled(pending)
    for (const result of settled) if (result.status === 'rejected') throw result.reason
  }
}
class InternetAuthError extends Error {}
