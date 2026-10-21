import { approvedRelayInstallations } from './relay-admission.js'
import { hash, secret, type AccountStore } from './store.js'
import { internetRegistrationPayload, type InternetRegistration } from '@dovo/protocol'
import { RequestError } from './http.js'

/** Account sessions authorize access; only ciphertext and public keys live at Connect. */
export class InternetStore {
  constructor(
    readonly accounts: AccountStore,
    readonly origin: string,
  ) {
    accounts.db.exec(`
      CREATE TABLE IF NOT EXISTS internet_hosts(user TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,identity TEXT NOT NULL,public_key TEXT NOT NULL,session TEXT NOT NULL,grant_hash TEXT NOT NULL UNIQUE,seen INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user,id));
      CREATE TABLE IF NOT EXISTS internet_blocks(user TEXT NOT NULL,host TEXT NOT NULL,session TEXT NOT NULL,PRIMARY KEY(user,host,session));
      CREATE TABLE IF NOT EXISTS internet_requests(id TEXT PRIMARY KEY,user TEXT NOT NULL,host TEXT NOT NULL,session TEXT NOT NULL,public_key TEXT NOT NULL,answer TEXT,created INTEGER NOT NULL,UNIQUE(user,host,session));`)
  }
  register(token: string, input: InternetRegistration) {
    const user = this.accounts.sessionUser(token)
    if (!user) throw new RequestError(401, 'Sign in again')
    const { signature, ...registration } = input
    if (
      !Number.isFinite(input.timestamp) ||
      Math.abs(this.accounts.now() - input.timestamp) > 60000
    )
      throw new RequestError(400, 'Registration expired')
    let valid = false
    try {
      valid = approvedRelayInstallations([input.identity])(
        input.identity,
        internetRegistrationPayload(this.origin, hash(token), registration),
        signature,
      )
    } catch {
      /* Invalid public key. */
    }
    if (!valid) throw new RequestError(403, 'Invalid computer proof')
    const previous = this.accounts.db
      .prepare('SELECT identity,public_key FROM internet_hosts WHERE user=? AND id=?')
      .get(user, input.id)
    if (
      previous &&
      (previous.identity !== input.identity || previous.public_key !== input.publicKey)
    )
      throw new RequestError(409, 'Unlink the previous installation before replacing its keys')
    const count = this.accounts.db
      .prepare('SELECT count(*) AS n FROM internet_hosts WHERE user=?')
      .get(user)
    if (!previous && Number(count?.n) >= 100) throw new RequestError(429, 'Computer limit reached')
    // Re-enabling invalidates earlier grants and encrypted device credentials.
    this.accounts.db
      .prepare('DELETE FROM internet_requests WHERE user=? AND host=?')
      .run(user, input.id)
    const grant = secret()
    this.accounts.db
      .prepare('INSERT OR REPLACE INTO internet_hosts VALUES(?,?,?,?,?,?,?,0)')
      .run(user, input.id, input.name, input.identity, input.publicKey, hash(token), hash(grant))
    return { grant }
  }
  host(grant: string) {
    const row = this.accounts.db
      .prepare(
        `SELECT h.* FROM internet_hosts h JOIN sessions s ON s.token=h.session WHERE h.grant_hash=? AND s.expires>?`,
      )
      .get(hash(grant), this.accounts.now())
    if (!row || typeof row.user !== 'string' || this.accounts.deleting(row.user)) return
    return {
      user: row.user,
      id: String(row.id),
      identity: String(row.identity),
      publicKey: String(row.public_key),
      session: String(row.session),
      seen: Number(row.seen),
    }
  }
  remove(user: string, id: string) {
    this.accounts.db.prepare('DELETE FROM internet_blocks WHERE user=? AND host=?').run(user, id)
    this.accounts.db.prepare('DELETE FROM internet_requests WHERE user=? AND host=?').run(user, id)
    this.accounts.db.prepare('DELETE FROM internet_hosts WHERE user=? AND id=?').run(user, id)
  }
  directory(user: string) {
    return this.accounts.db
      .prepare(
        `SELECT h.id,h.name,h.public_key,h.seen FROM internet_hosts h JOIN sessions s ON h.session=s.token WHERE h.user=? AND s.expires>?`,
      )
      .all(user, this.accounts.now())
      .map((row) => ({
        id: String(row.id),
        name: String(row.name),
        address: '',
        internet: {
          publicKey: String(row.public_key),
          online: Number(row.seen) > this.accounts.now() - 15000,
        },
      }))
  }
  request(token: string, host: string, publicKey: string) {
    const user = this.accounts.sessionUser(token)
    if (!user) throw new RequestError(401, 'Sign in again')
    if (!this.directory(user).some((item) => item.id === host && item.internet.online))
      throw new RequestError(503, 'This computer is offline or Dovo Connect is disabled')
    if (
      this.accounts.db
        .prepare('SELECT session FROM internet_blocks WHERE user=? AND host=? AND session=?')
        .get(user, host, hash(token))
    )
      throw new RequestError(
        403,
        'This account session was revoked on the computer. Sign in again to request access.',
      )
    const count = this.accounts.db
      .prepare('SELECT count(*) AS n FROM internet_requests WHERE user=? AND host=?')
      .get(user, host)
    if (
      Number(count?.n) >= 100 &&
      !this.accounts.db
        .prepare('SELECT id FROM internet_requests WHERE user=? AND host=? AND session=?')
        .get(user, host, hash(token))
    )
      throw new RequestError(429, 'Device limit reached')
    const previous = this.accounts.db
      .prepare('SELECT id,public_key FROM internet_requests WHERE user=? AND host=? AND session=?')
      .get(user, host, hash(token))
    if (previous?.public_key === publicKey) return { id: String(previous.id) }
    const id = secret()
    this.accounts.db
      .prepare('INSERT OR REPLACE INTO internet_requests VALUES(?,?,?,?,?,NULL,?)')
      .run(id, user, host, hash(token), publicKey, this.accounts.now())
    return { id }
  }
  inbox(grant: string) {
    const host = this.host(grant)
    if (!host) throw new RequestError(401, 'Internet access has been revoked')
    this.accounts.db
      .prepare('UPDATE internet_hosts SET seen=? WHERE grant_hash=?')
      .run(this.accounts.now(), hash(grant))
    this.accounts.db
      .prepare(
        'DELETE FROM internet_requests WHERE session NOT IN (SELECT token FROM sessions WHERE expires>?)',
      )
      .run(this.accounts.now())
    const requests = this.accounts.db
      .prepare('SELECT id,public_key,session,answer FROM internet_requests WHERE user=? AND host=?')
      .all(host.user, host.id)
    return {
      host: {
        id: host.id,
        identity: host.identity,
        publicKey: host.publicKey,
        session: host.session,
      },
      active: requests.map((row) => String(row.id)),
      requests: requests
        .filter((row) => !row.answer)
        .map((row) => ({
          id: String(row.id),
          publicKey: String(row.public_key),
          session: String(row.session),
        })),
    }
  }
  block(grant: string, session: string) {
    const host = this.host(grant)
    if (!host) throw new RequestError(401, 'Internet access has been revoked')
    if (
      !this.accounts.db
        .prepare('SELECT token FROM sessions WHERE user=? AND token=?')
        .get(host.user, session)
    )
      return
    this.accounts.db
      .prepare('INSERT OR IGNORE INTO internet_blocks VALUES(?,?,?)')
      .run(host.user, host.id, session)
    this.accounts.db
      .prepare('DELETE FROM internet_requests WHERE user=? AND host=? AND session=?')
      .run(host.user, host.id, session)
  }
  answer(grant: string, id: string, box: unknown) {
    const host = this.host(grant)
    if (!host) throw new RequestError(401, 'Internet access has been revoked')
    if (
      !this.accounts.db
        .prepare(
          `UPDATE internet_requests SET answer=? WHERE id=? AND user=? AND host=? AND session IN (SELECT token FROM sessions WHERE expires>?)`,
        )
        .run(JSON.stringify(box), id, host.user, host.id, this.accounts.now()).changes
    )
      throw new RequestError(404, 'Connection request expired')
  }
  result(token: string, id: string) {
    const user = this.accounts.sessionUser(token)
    if (!user) throw new RequestError(401, 'Sign in again')
    const row = this.accounts.db
      .prepare(
        `SELECT r.answer,h.public_key FROM internet_requests r JOIN internet_hosts h ON r.user=h.user AND r.host=h.id JOIN sessions s ON s.token=h.session WHERE r.id=? AND r.user=? AND r.session=? AND s.expires>?`,
      )
      .get(id, user, hash(token), this.accounts.now())
    if (!row) throw new RequestError(404, 'Connection request expired')
    return {
      publicKey: String(row.public_key),
      box: typeof row.answer === 'string' ? (JSON.parse(row.answer) as unknown) : null,
    }
  }
}
