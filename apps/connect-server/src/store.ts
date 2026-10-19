import { DatabaseSync } from 'node:sqlite'
import { createHash, randomBytes } from 'node:crypto'
import type { AccountDirectory, AccountServer } from '@dovo/protocol'
export const secret = () => randomBytes(32).toString('base64url')
export const hash = (value: string) => createHash('sha256').update(value).digest('base64url')
export type Login = {
  id: string
  tokenHash: string
  code: string
  expires: number
  state?: string
  nonce?: string
  verifier?: string
  browserHash?: string
}
export class AccountStore {
  readonly db: DatabaseSync
  constructor(
    path: string,
    readonly now = Date.now,
  ) {
    this.db = new DatabaseSync(path)
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS logins(id TEXT PRIMARY KEY,value TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS deleted_accounts(id TEXT PRIMARY KEY,verified INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS servers(user TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,address TEXT NOT NULL,PRIMARY KEY(user,id));`)
    if (
      !this.db
        .prepare('PRAGMA table_info(deleted_accounts)')
        .all()
        .some((row) => row.name === 'verified')
    )
      this.db.exec('ALTER TABLE deleted_accounts ADD COLUMN verified INTEGER NOT NULL DEFAULT 0')
  }
  cleanup() {
    this.db.prepare('DELETE FROM logins WHERE expires<=?').run(this.now())
    this.db.prepare('DELETE FROM sessions WHERE expires<=?').run(this.now())
  }
  createLogin() {
    this.cleanup()
    const count = this.db.prepare('SELECT count(*) AS n FROM logins').get()
    if (Number(count?.n) >= 1000) throw new Error('Too many pending sign-ins')
    const token = secret()
    const login: Login = {
      id: secret(),
      tokenHash: hash(token),
      code: randomBytes(4).toString('hex').toUpperCase(),
      expires: this.now() + 300_000,
    }
    this.saveLogin(login)
    return { login, token }
  }
  saveLogin(login: Login) {
    this.db
      .prepare('INSERT OR REPLACE INTO logins VALUES(?,?,?)')
      .run(login.id, JSON.stringify(login), login.expires)
  }
  login(id: string): Login | undefined {
    const row = this.db
      .prepare('SELECT value FROM logins WHERE id=? AND expires>?')
      .get(id, this.now())
    if (!row || typeof row.value !== 'string') return
    // Values originate only from saveLogin in this process.
    const value: Login = JSON.parse(row.value)
    return value
  }
  pendingLogin(token: string): boolean {
    return !!this.db
      .prepare("SELECT id FROM logins WHERE json_extract(value,'$.tokenHash')=? AND expires>?")
      .get(hash(token), this.now())
  }
  approve(login: Login, user: { id: string; name: string }) {
    if (this.deleting(user.id)) throw new Error('Account deletion has started')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const removed = this.db
        .prepare('DELETE FROM logins WHERE id=? AND expires>?')
        .run(login.id, this.now())
      if (!removed.changes) throw new Error('Sign-in expired or already completed')
      this.db.prepare('INSERT OR REPLACE INTO users VALUES(?,?)').run(user.id, user.name)
      this.db
        .prepare('INSERT INTO sessions VALUES(?,?,?)')
        .run(login.tokenHash, user.id, this.now() + 30 * 86400_000)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  directory(token: string, allowDeleting = false): AccountDirectory | undefined {
    const user = this.db
      .prepare(
        'SELECT users.id,users.name FROM sessions JOIN users ON users.id=sessions.user WHERE token=? AND expires>?',
      )
      .get(hash(token), this.now())
    if (!user || typeof user.id !== 'string' || typeof user.name !== 'string') return
    if (!allowDeleting && this.deleting(user.id)) return
    const servers = this.db
      .prepare('SELECT id,name,address FROM servers WHERE user=? ORDER BY name,id')
      .all(user.id)
      .map((row) => ({ id: String(row.id), name: String(row.name), address: String(row.address) }))
    return { user: { id: user.id, name: user.name }, servers }
  }
  link(user: string, server: AccountServer) {
    const count = this.db.prepare('SELECT count(*) AS n FROM servers WHERE user=?').get(user)
    if (
      Number(count?.n) >= 100 &&
      !this.db.prepare('SELECT id FROM servers WHERE user=? AND id=?').get(user, server.id)
    )
      throw new Error('Account server limit reached')
    this.db
      .prepare('INSERT OR REPLACE INTO servers VALUES(?,?,?,?)')
      .run(user, server.id, server.name, server.address)
  }
  unlink(user: string, id: string) {
    this.db.prepare('DELETE FROM servers WHERE user=? AND id=?').run(user, id)
  }
  deleting(user: string) {
    return !!this.db.prepare('SELECT id FROM deleted_accounts WHERE id=?').get(hash(user))
  }
  beginDeletion(user: string) {
    this.db.prepare('INSERT OR IGNORE INTO deleted_accounts(id) VALUES(?)').run(hash(user))
  }
  deletionVerified(user: string) {
    return (
      this.db.prepare('SELECT verified FROM deleted_accounts WHERE id=?').get(hash(user))
        ?.verified === 1
    )
  }
  verifyDeletion(user: string) {
    this.db.prepare('UPDATE deleted_accounts SET verified=1 WHERE id=?').run(hash(user))
  }
  deleteAccount(user: string) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.beginDeletion(user)
      this.db.prepare('DELETE FROM sessions WHERE user=?').run(user)
      this.db.prepare('DELETE FROM servers WHERE user=?').run(user)
      this.db.prepare('DELETE FROM users WHERE id=?').run(user)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  revoke(token: string) {
    this.db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token))
    for (const row of this.db.prepare('SELECT id,value FROM logins').all()) {
      if (
        typeof row.value === 'string' &&
        typeof row.id === 'string' &&
        JSON.parse(row.value).tokenHash === hash(token)
      )
        this.db.prepare('DELETE FROM logins WHERE id=?').run(row.id)
    }
  }
}
