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
export class Devices {
  constructor(
    private readonly db: Database.Database,
    private readonly ownerToken: string,
  ) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS provisional_devices (device_id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)',
    )
    this.expireProvisional()
  }
  private expireProvisional() {
    const now = Date.now()
    if (
      !this.db
        .prepare('SELECT device_id FROM provisional_devices WHERE expires_at<=? LIMIT 1')
        .get(now)
    )
      return
    this.db.transaction(() => {
      this.db
        .prepare(
          'UPDATE devices SET revoked_at=? WHERE revoked_at IS NULL AND id IN (SELECT device_id FROM provisional_devices WHERE expires_at<=?)',
        )
        .run(new Date(now).toISOString(), now)
      this.db.prepare('DELETE FROM provisional_devices WHERE expires_at<=?').run(now)
    })()
  }
  confirm(id: string) {
    this.expireProvisional()
    if (!this.db.prepare('SELECT id FROM devices WHERE id=? AND revoked_at IS NULL').get(id))
      throw new HttpError(401, 'Device authentication required')
    this.db.prepare('DELETE FROM provisional_devices WHERE device_id=?').run(id)
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
  }
}
