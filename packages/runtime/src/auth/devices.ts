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
  ) {}
  authenticate(token: string) {
    if (token && equalSecret(token, this.ownerToken)) return { id: 'owner', owner: true }
    const row = this.db
      .prepare(
        'SELECT id,name,created_at as createdAt,revoked_at as revokedAt FROM devices WHERE token_hash=? AND revoked_at IS NULL',
      )
      .get(hashSecret(token))
    if (!row) throw new HttpError(401, 'Device authentication required')
    return { id: deviceSchema.parse(row).id, owner: false }
  }
  add(name: string, token: string) {
    const id = randomUUID()
    this.db
      .prepare('INSERT INTO devices VALUES (?,?,?,?,NULL)')
      .run(id, name, hashSecret(token), new Date().toISOString())
    return id
  }
  list() {
    return this.db
      .prepare('SELECT id,name,created_at as createdAt,revoked_at as revokedAt FROM devices')
      .all()
      .map((row) => deviceSchema.parse(row))
  }
  revoke(id: string) {
    this.db.prepare('UPDATE devices SET revoked_at=? WHERE id=?').run(new Date().toISOString(), id)
  }
}
