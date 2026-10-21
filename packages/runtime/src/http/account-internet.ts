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
  type PeerConfig,
  type InternetRegistration,
} from '@dovo/protocol'
import { HttpError } from '../errors.js'
import type { Devices } from '../auth/devices.js'
import type { PeerConnections } from './peer-connections.js'
import type { peerRelayIdentity } from './peer-relay-identity.js'
const inboxSchema = Schema.Struct({
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
  private controller?: AbortController
  private generation = 0
  private lease = 0
  private running = false
  private enabling = false
  private setups = new Map<
    string,
    { id: string; session: string; registration: InternetRegistration; generation: number }
  >()
  private error = ''
  private readonly privateKey: Uint8Array
  readonly publicKey: string
  private readonly origin = process.env.DOVO_CONNECT_ORIGIN ?? ACCOUNT_DIRECTORY_URL
  constructor(
    private readonly db: Database.Database,
    private readonly devices: Devices,
    private readonly peers: PeerConnections,
    private readonly identity: ReturnType<typeof peerRelayIdentity>,
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS account_internet(id INTEGER PRIMARY KEY CHECK(id=1),secret TEXT NOT NULL,state TEXT);
      CREATE TABLE IF NOT EXISTS account_internet_devices(request TEXT PRIMARY KEY,device TEXT NOT NULL,answer TEXT NOT NULL,session TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS account_internet_blocks(session TEXT PRIMARY KEY);`)
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
  prepareSetup(deviceId: string, session: string, runtimeId: string, name: string) {
    if (!this.running) throw new HttpError(409, 'Internet connections are not running')
    if (this.state || this.enabling)
      throw new HttpError(409, 'Dovo Connect is already enabled or being configured')
    for (const [device, setup] of this.setups)
      if (Date.now() - setup.registration.timestamp >= 60000) this.setups.delete(device)
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
  async enable(token: string, runtimeId: string, name: string) {
    if (!this.running) throw new Error('Internet connections are not running')
    if (this.state || this.enabling)
      throw new Error('Dovo Connect is already enabled. Disable it before changing accounts.')
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
  private async poll() {
    if (!this.running || !this.state) return
    if (this.timer) clearTimeout(this.timer)
    const generation = this.generation,
      state = this.state
    try {
      for (const row of this.db.prepare('SELECT session FROM account_internet_blocks').all()) {
        const { session } = decode(Schema.Struct({ session: Schema.String }), row)
        await this.request('/v1/internet/host/block', state.grant, 'POST', { session })
        if (generation !== this.generation) return
        this.db.prepare('DELETE FROM account_internet_blocks WHERE session=?').run(session)
      }
      const inbox = decode(inboxSchema, await this.request('/v1/internet/host', state.grant))
      if (generation !== this.generation) return
      this.lease = Date.now() + 12000
      this.error = ''
      this.removeExcept(new Set(inbox.active))
      for (const request of inbox.requests) {
        if (generation !== this.generation) return
        if (
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
            if (generation !== this.generation) {
              this.peers.disable(device)
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
            this.db.prepare('DELETE FROM account_internet_devices WHERE request=?').run(request.id)
            this.devices.revoke(device)
            throw error
          }
        }
        await this.request('/v1/internet/host', state.grant, 'POST', { id: request.id, box })
      }
      if (generation !== this.generation) return
      for (const row of this.db.prepare('SELECT device FROM account_internet_devices').all()) {
        const { device } = decode(Schema.Struct({ device: Schema.String }), row)
        await this.peers.enable(device, 'dovo', state.grant)
      }
    } catch (error) {
      if (generation !== this.generation) return
      this.error =
        'Dovo Connect is unavailable. Internet access pauses when its authorization lease expires.'
      if (error instanceof InternetAuthError) {
        await this.disable()
        this.error = 'Account access was revoked. Sign in and enable Dovo Connect again.'
        return
      }
    } finally {
      if (this.running && this.state && generation === this.generation) {
        this.timer = setTimeout(() => void this.poll(), 3000)
        this.timer.unref()
      }
    }
  }
  private async request(path: string, token: string, method = 'GET', body?: unknown) {
    // Optional Connect configuration must not affect ordinary LAN/VPN startup.
    // Validate its HTTPS (or loopback test) origin before sending any credential.
    decode(peerConfigSchema.fields.origin, this.origin)
    const controller = new AbortController()
    this.controller = controller
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
      if (this.controller === controller) this.controller = undefined
    }
  }
  stop() {
    this.running = false
    this.generation++
    this.setups.clear()
    this.lease = 0
    this.controller?.abort()
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }
}
class InternetAuthError extends Error {}
