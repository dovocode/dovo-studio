import type { IncomingMessage, ServerResponse } from 'node:http'
import { decode, sharingKeyAnswerSchema, sharingKeyPresenceSchema } from '@dovo/protocol'
import { AccountStore, hash } from './store.js'
import { bearerToken, json, readJson, RequestError } from './http.js'

/** Session-bound, short-lived mailboxes. Only devices receive the decryption keys. */
export function sharingKeySyncApi(store: AccountStore) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS sharing_key_sync(
    public_key TEXT PRIMARY KEY,user TEXT NOT NULL,session TEXT NOT NULL,
    has_key INTEGER NOT NULL,answer TEXT,seen INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sharing_key_identity(user TEXT PRIMARY KEY,key_hash TEXT NOT NULL)`)
  return async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    if (url.pathname !== '/v1/sharing-keys') return false
    const token = bearerToken(req),
      user = store.sessionUser(token)
    if (!user) throw new RequestError(401, 'Sign in to sync sharing access')
    store.cleanupSharingKeys()
    const session = hash(token)
    if (req.method === 'POST') {
      const input = decode(sharingKeyPresenceSchema, await readJson(req))
      if (input.hasKey !== (input.keyHash !== null))
        throw new RequestError(400, 'Invalid sharing key presence')
      const previous = store.db
        .prepare('SELECT session FROM sharing_key_sync WHERE public_key=?')
        .get(input.publicKey)
      if (previous && previous.session !== session)
        throw new RequestError(409, 'Sharing device identity is already in use')
      const count = store.db
        .prepare('SELECT count(*) AS n FROM sharing_key_sync WHERE user=?')
        .get(user)
      if (!previous && Number(count?.n) >= 100)
        throw new RequestError(429, 'Too many sharing devices are active')
      if (input.rejectAnswer && previous)
        store.db
          .prepare(
            "UPDATE sharing_key_sync SET answer=NULL WHERE public_key=? AND session=? AND json_extract(answer, '$.box.nonce')=?",
          )
          .run(input.publicKey, session, input.rejectAnswer)
      // Only a fingerprint persists. Concurrent first shares must converge before publishing.
      if (input.keyHash)
        store.db
          .prepare('INSERT OR IGNORE INTO sharing_key_identity VALUES(?,?)')
          .run(user, input.keyHash)
      const identity = store.db
        .prepare('SELECT key_hash FROM sharing_key_identity WHERE user=?')
        .get(user)
      const keyHash = typeof identity?.key_hash === 'string' ? identity.key_hash : null
      const hasKey = input.hasKey && input.keyHash === keyHash
      store.db
        .prepare(`INSERT INTO sharing_key_sync VALUES(?,?,?,?,NULL,?)
          ON CONFLICT(public_key) DO UPDATE SET has_key=excluded.has_key,seen=excluded.seen,
          answer=CASE WHEN excluded.has_key=1 THEN NULL ELSE sharing_key_sync.answer END`)
        .run(input.publicKey, user, session, Number(hasKey), store.now())
      const row = store.db
        .prepare('SELECT answer FROM sharing_key_sync WHERE public_key=?')
        .get(input.publicKey)
      json(res, 200, {
        keyHash,
        requests: hasKey
          ? store.db
              .prepare(
                'SELECT public_key FROM sharing_key_sync WHERE user=? AND has_key=0 AND answer IS NULL AND public_key<>?',
              )
              .all(user, input.publicKey)
              .map((entry) => String(entry.public_key))
          : [],
        answer: typeof row?.answer === 'string' ? JSON.parse(row.answer) : null,
      })
      return true
    }
    if (req.method === 'PUT') {
      const input = decode(sharingKeyAnswerSchema, await readJson(req))
      const sender = store.db
        .prepare(
          'SELECT public_key FROM sharing_key_sync WHERE user=? AND session=? AND public_key=? AND has_key=1',
        )
        .get(user, session, input.sender)
      if (!sender) throw new RequestError(403, 'Sharing source is unavailable')
      const recipient = store.db
        .prepare('SELECT has_key FROM sharing_key_sync WHERE user=? AND public_key=?')
        .get(user, input.recipient)
      if (recipient && recipient.has_key === 0)
        store.db
          .prepare(
            'UPDATE sharing_key_sync SET answer=? WHERE user=? AND public_key=? AND answer IS NULL',
          )
          .run(JSON.stringify(input), user, input.recipient)
      // A receiver may have closed or already synced. Never overwrite another answer.
      json(res, 200, { ok: true })
      return true
    }
    throw new RequestError(405, 'Method not allowed')
  }
}
