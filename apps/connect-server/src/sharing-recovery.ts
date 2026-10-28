import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { decode, sharingHash, sharingKeySchema, sharingRecoverySaveSchema } from '@dovo/protocol'
import type { AccountStore } from './store.js'
import { bearerToken, json, readJson, RequestError } from './http.js'

/** Provisioned once in Connect's private persistent volume, never exposed to clients or logs. */
export function sharingRecoverySecret(path: string, hasRecoveries: boolean): Buffer {
  if (!existsSync(path)) {
    if (hasRecoveries)
      throw new Error('Restore Connect sharing-recovery.key from the server backup')
    try {
      writeFileSync(path, randomBytes(32), { flag: 'wx', mode: 0o600 })
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
    }
  }
  chmodSync(path, 0o600)
  const key = readFileSync(path)
  if (key.length !== 32) throw new Error('Invalid Connect sharing recovery encryption key')
  return key
}

export function sharingRecoveryApi(store: AccountStore, origin: string, secret?: Uint8Array) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS sharing_key_recovery(
    user TEXT PRIMARY KEY, sealed TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sharing_key_identity(user TEXT PRIMARY KEY,key_hash TEXT NOT NULL)`)
  if (secret && secret.length !== 32) throw new Error('Invalid sharing recovery encryption key')
  const identity = (user: string) => {
    const row = store.db.prepare('SELECT key_hash FROM sharing_key_identity WHERE user=?').get(user)
    return typeof row?.key_hash === 'string' ? row.key_hash : null
  }
  return async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    if (url.pathname !== '/v1/sharing-recovery') return false
    const user = store.sessionUser(bearerToken(req))
    if (!user) throw new RequestError(401, 'Sign in to recover sharing access')
    if (!secret)
      throw new RequestError(503, 'Account sharing recovery is not configured on Connect')
    const aad = Buffer.from(JSON.stringify(['dovo-sharing-recovery-v1', origin, user]))
    const read = () => {
      const row = store.db.prepare('SELECT sealed FROM sharing_key_recovery WHERE user=?').get(user)
      if (typeof row?.sealed !== 'string') return null
      const packet = Buffer.from(row.sealed, 'base64url')
      const decipher = createDecipheriv('aes-256-gcm', secret, packet.subarray(0, 12))
      decipher.setAAD(aad)
      decipher.setAuthTag(packet.subarray(12, 28))
      const key = decode(
        sharingKeySchema,
        Buffer.concat([decipher.update(packet.subarray(28)), decipher.final()]).toString('utf8'),
      )
      if (sharingHash(key) !== identity(user)) throw new Error('Sharing recovery identity mismatch')
      return key
    }
    if (req.method === 'GET') {
      json(res, 200, { keyHash: identity(user), key: read() })
      return true
    }
    if (req.method !== 'PUT') throw new RequestError(405, 'Method not allowed')
    const input = decode(sharingRecoverySaveSchema, await readJson(req))
    // No await inside this transaction: concurrent first-time devices converge on one key.
    store.db.exec('BEGIN IMMEDIATE')
    try {
      const previous = read(),
        fingerprint = identity(user)
      if (input.reset && (previous || input.reset.keyHash !== fingerprint))
        throw new RequestError(409, 'Sharing recovery changed. Refresh before resetting.')
      if (previous) {
        store.db.exec('COMMIT')
        json(res, 200, { keyHash: fingerprint, key: previous })
        return true
      }
      const keyHash = sharingHash(input.key)
      if (!input.reset && fingerprint && fingerprint !== keyHash)
        throw new RequestError(409, 'Restore the original sharing key or reset legacy sharing')
      const nonce = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', secret, nonce)
      cipher.setAAD(aad)
      const encrypted = Buffer.concat([cipher.update(input.key, 'utf8'), cipher.final()])
      store.db
        .prepare('INSERT INTO sharing_key_recovery VALUES(?,?)')
        .run(user, Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64url'))
      store.db
        .prepare(`INSERT INTO sharing_key_identity VALUES(?,?)
        ON CONFLICT(user) DO UPDATE SET key_hash=excluded.key_hash`)
        .run(user, keyHash)
      if (input.reset) store.db.prepare('DELETE FROM sharing_key_sync WHERE user=?').run(user)
      store.db.exec('COMMIT')
      json(res, 200, { keyHash, key: input.key })
    } catch (error) {
      store.db.exec('ROLLBACK')
      throw error
    }
    return true
  }
}
