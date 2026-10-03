import { decode } from '@dovo/protocol'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type Database from 'better-sqlite3'
import { deviceSchema } from '@dovo/protocol'
import { HttpError } from '../errors.js'
export const hashSecret = (value: string) => createHash('sha256').update(value).digest('hex')
export const newSecret = () => randomBytes(32).toString('base64url')
export function equalSecret(a: string, b: string) {
  return timingSafeEqual(Buffer.from(hashSecret(a)), Buffer.from(hashSecret(b)))
}
type DeviceRevision = { revision: number; checkAt: number }
const revisions = new WeakMap<Database.Database, DeviceRevision>()
export class Devices {
  private get state() {
    let state = revisions.get(this.db)
    if (!state) revisions.set(this.db, (state = { revision: 0, checkAt: 0 }))
    return state
  }
  private invalidate() {
    this.state.revision++
    this.state.checkAt = 0
  }
  version() {
    this.expireProvisional()
    return this.state.revision
  }
  constructor(
    private readonly db: Database.Database,
    private readonly ownerToken: string,
  ) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS provisional_devices (device_id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)',
    )
    this.invalidate()
    this.expireProvisional()
  }
  private expireProvisional() {
    const now = Date.now()
    if (now < this.state.checkAt) return
    // Expiry is a deadline, not a polling delay. The bounded refresh also observes
    // changes made by another connection to the database.
    const nextCheck = () => {
      const next = this.db.prepare('SELECT MIN(expires_at) AS at FROM provisional_devices').get()
      const at =
        next && typeof next === 'object' && 'at' in next && typeof next.at === 'number'
          ? next.at
          : Infinity
      this.state.checkAt = Math.min(now + 15000, at)
    }
    if (
      !this.db
        .prepare('SELECT device_id FROM provisional_devices WHERE expires_at<=? LIMIT 1')
        .get(now)
    ) {
      nextCheck()
      return
    }
    const changed = this.db.transaction(() => {
      const result = this.db
        .prepare(
          'UPDATE devices SET revoked_at=? WHERE revoked_at IS NULL AND id IN (SELECT device_id FROM provisional_devices WHERE expires_at<=?)',
        )
        .run(new Date(now).toISOString(), now)
      this.db.prepare('DELETE FROM provisional_devices WHERE expires_at<=?').run(now)
      return result.changes > 0
    })()
    if (changed) this.state.revision++
    nextCheck()
  }
  confirm(id: string) {
    this.expireProvisional()
    if (!this.db.prepare('SELECT id FROM devices WHERE id=? AND revoked_at IS NULL').get(id))
      throw new HttpError(401, 'Device authentication required')
    this.db.prepare('DELETE FROM provisional_devices WHERE device_id=?').run(id)
    this.invalidate()
  }
  authenticate(token: string) {
    this.expireProvisional()
    if (token && equalSecret(token, this.ownerToken))
      return {
        id: 'owner',
        owner: true,
      }
    const row = this.db
      .prepare(
        'SELECT id,name,created_at as createdAt,revoked_at as revokedAt FROM devices WHERE token_hash=? AND revoked_at IS NULL',
      )
      .get(hashSecret(token))
    if (!row) throw new HttpError(401, 'Device authentication required')
    return {
      id: decode(deviceSchema, row).id,
      owner: false,
    }
  }
  add(name: string, token: string, provisionalMs?: number) {
    const id = randomUUID()
    this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO devices VALUES (?,?,?,?,NULL)')
        .run(id, name, hashSecret(token), new Date().toISOString())
      if (provisionalMs !== undefined)
        this.db
          .prepare('INSERT INTO provisional_devices VALUES (?, ?)')
          .run(id, Date.now() + provisionalMs)
    })()
    this.invalidate()
    return id
  }
  list() {
    this.expireProvisional()
    return this.db
      .prepare('SELECT id,name,created_at as createdAt,revoked_at as revokedAt FROM devices')
      .all()
      .map((row) => decode(deviceSchema, row))
  }
  revoke(id: string) {
    this.db.prepare('UPDATE devices SET revoked_at=? WHERE id=?').run(new Date().toISOString(), id)
    this.invalidate()
  }
}
