import { DatabaseSync } from 'node:sqlite'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import type { AccountDirectory, AccountServer } from '@dovo/protocol'
import type { AccountIdentity } from './oidc.js'
import { RequestError } from './http.js'
import { PeopleStore } from './people-store.js'
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
  organization?: string
  artifactsOrigin?: string
  remoteMcp?: RemoteMcpLogin | 'manage'
}
export type RemoteMcpLogin = {
  runtimeId: string
  clientId: string
  redirect: string
  challenge: string
  state?: string
}
export class AccountStore {
  private organizations: ReadonlyMap<string, string> = new Map()
  readonly db: DatabaseSync
  readonly people: PeopleStore
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
      CREATE TABLE IF NOT EXISTS organization_sessions(token TEXT PRIMARY KEY,organization TEXT NOT NULL,name TEXT NOT NULL,policy TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS organization_identities(user TEXT PRIMARY KEY,organization TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS servers(user TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,address TEXT NOT NULL,PRIMARY KEY(user,id));
      CREATE TABLE IF NOT EXISTS artifact_sessions(token TEXT PRIMARY KEY,audience TEXT NOT NULL,parent TEXT);
      CREATE TABLE IF NOT EXISTS reusable_grants(token TEXT PRIMARY KEY,nonce TEXT NOT NULL,purpose TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS artifact_feed_grants(token TEXT PRIMARY KEY,publication TEXT NOT NULL);`)
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS sharing_key_recovery(user TEXT PRIMARY KEY,sealed TEXT NOT NULL)',
    )
    if (
      !this.db
        .prepare('PRAGMA table_info(deleted_accounts)')
        .all()
        .some((row) => row.name === 'verified')
    )
      this.db.exec('ALTER TABLE deleted_accounts ADD COLUMN verified INTEGER NOT NULL DEFAULT 0')
    this.migratePendingDeletions()
    this.people = new PeopleStore(this)
  }
  cleanup() {
    this.db.prepare('DELETE FROM logins WHERE expires<=?').run(this.now())
    this.db.prepare('DELETE FROM sessions WHERE expires<=?').run(this.now())
    this.db
      .prepare('DELETE FROM reusable_grants WHERE token NOT IN (SELECT token FROM sessions)')
      .run()
    this.cleanupSharingKeys()
    this.db
      .prepare('DELETE FROM organization_sessions WHERE token NOT IN (SELECT token FROM sessions)')
      .run()
    this.db
      .prepare(
        'DELETE FROM sessions WHERE token IN (SELECT token FROM artifact_sessions WHERE parent IS NOT NULL AND parent NOT IN (SELECT token FROM sessions))',
      )
      .run()
    this.db
      .prepare('DELETE FROM artifact_sessions WHERE token NOT IN (SELECT token FROM sessions)')
      .run()
    this.db
      .prepare('DELETE FROM artifact_feed_grants WHERE token NOT IN (SELECT token FROM sessions)')
      .run()
  }
  cleanupSharingKeys() {
    if (
      !this.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sharing_key_sync'")
        .get()
    )
      return
    this.db
      .prepare(`DELETE FROM sharing_key_sync WHERE seen<=? OR session NOT IN
      (SELECT token FROM sessions WHERE expires>?)`)
      .run(this.now() - 300_000, this.now())
  }
  createLogin(artifactsOrigin?: string) {
    this.cleanup()
    const count = this.db.prepare('SELECT count(*) AS n FROM logins').get()
    if (Number(count?.n) >= 1000) throw new Error('Too many pending sign-ins')
    const token = secret()
    const login: Login = {
      id: secret(),
      tokenHash: hash(token),
      code: randomBytes(4).toString('hex').toUpperCase(),
      expires: this.now() + 300_000,
      ...(artifactsOrigin ? { artifactsOrigin } : {}),
    }
    this.saveLogin(login)
    return { login, token }
  }
  saveLogin(login: Login) {
    this.db
      .prepare('INSERT OR REPLACE INTO logins VALUES(?,?,?)')
      .run(login.id, JSON.stringify(login), login.expires)
  }
  cancelLogin(login: Login) {
    this.db
      .prepare('DELETE FROM logins WHERE id=? AND value=?')
      .run(login.id, JSON.stringify(login))
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
  configureOrganizations(versions: ReadonlyMap<string, string>) {
    this.organizations = versions
    for (const row of this.db
      .prepare('SELECT token,organization,policy FROM organization_sessions')
      .all()) {
      if (typeof row.organization !== 'string' || versions.get(row.organization) !== row.policy)
        this.db.prepare('DELETE FROM sessions WHERE token=?').run(String(row.token))
    }
    this.cleanup()
  }
  organizationSession(sessionHash: string) {
    const row = this.db
      .prepare(
        'SELECT o.* FROM organization_sessions o JOIN sessions s ON s.token=o.token WHERE o.token=? AND s.expires>?',
      )
      .get(sessionHash, this.now())
    if (
      !row ||
      typeof row.organization !== 'string' ||
      typeof row.name !== 'string' ||
      this.organizations.get(row.organization) !== row.policy
    )
      return
    return { id: row.organization, name: row.name }
  }
  organizationIdentity(user: string) {
    return !!this.db.prepare('SELECT user FROM organization_identities WHERE user=?').get(user)
  }
  approve(login: Login, user: AccountIdentity) {
    if (this.deleting(user.id))
      throw new RequestError(409, 'This account is deleted or its deletion is in progress.')
    if (
      user.organization &&
      this.organizations.get(user.organization.id) !== user.organization.policy
    )
      throw new Error('Organization access is unavailable')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const removed = this.db
        .prepare('DELETE FROM logins WHERE id=? AND expires>?')
        .run(login.id, this.now())
      if (!removed.changes) throw new Error('Sign-in expired or already completed')
      this.db.prepare('INSERT OR REPLACE INTO users VALUES(?,?)').run(user.id, user.name)
      this.db
        .prepare('INSERT INTO sessions VALUES(?,?,?)')
        .run(
          login.tokenHash,
          user.id,
          Math.min(
            this.now() + (login.artifactsOrigin ? 8 * 3600_000 : 30 * 86400_000),
            user.sessionExpiresAt ?? Infinity,
          ),
        )
      if (login.artifactsOrigin)
        this.db
          .prepare('INSERT INTO artifact_sessions VALUES(?,?,NULL)')
          .run(login.tokenHash, login.artifactsOrigin)
      if (user.organization) {
        this.db
          .prepare('INSERT INTO organization_sessions VALUES(?,?,?,?)')
          .run(
            login.tokenHash,
            user.organization.id,
            user.organization.name,
            user.organization.policy,
          )
        this.db
          .prepare('INSERT OR REPLACE INTO organization_identities VALUES(?,?)')
          .run(user.id, user.organization.id)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  sessionUser(token: string, allowDeleting = false): string | undefined {
    if (this.db.prepare('SELECT 1 FROM artifact_sessions WHERE token=?').get(hash(token))) return
    const session = this.db
      .prepare('SELECT user FROM sessions WHERE token=? AND expires>?')
      .get(hash(token), this.now())
    if (typeof session?.user !== 'string' || (!allowDeleting && this.deleting(session.user))) return
    return session.user
  }
  artifactGrant(
    token: string,
    audience: string,
    publicationId?: string,
    purpose?: 'artifacts' | 'sharing',
  ) {
    this.cleanup()
    const parent = hash(token)
    const derive = (nonce: string) =>
      createHmac('sha256', token)
        .update(JSON.stringify(['artifact-session-v1', audience, purpose, nonce]))
        .digest('base64url')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const user = this.sessionUser(token)
      const session = this.db.prepare('SELECT expires FROM sessions WHERE token=?').get(parent)
      if (!user || typeof session?.expires !== 'number') {
        this.db.exec('COMMIT')
        return
      }
      if (purpose && !publicationId) {
        const existing = this.db
          .prepare(`SELECT r.nonce,s.expires FROM artifact_sessions a
          JOIN sessions s ON s.token=a.token JOIN reusable_grants r ON r.token=a.token
          WHERE a.parent=? AND a.audience=? AND r.purpose=? AND s.expires>=?
          ORDER BY s.expires DESC LIMIT 1`)
          // Allow the hosted request to finish within its 30-second timeout. A child
          // cannot outlive its parent, so reuse the final grant until both expire.
          .get(parent, audience, purpose, Math.min(this.now() + 30_000, session.expires))
        if (typeof existing?.nonce === 'string' && typeof existing.expires === 'number') {
          this.db.exec('COMMIT')
          return { token: derive(existing.nonce), expiresAt: existing.expires, origin: audience }
        }
      }
      const nonce = secret()
      const grant = purpose && !publicationId ? derive(nonce) : nonce
      const expiresAt = Math.min(
        this.now() + (publicationId ? 30 * 86400_000 : 600_000),
        session.expires,
      )
      if (publicationId) {
        // Reapproval replaces this parent's previous writer for the same publication.
        this.db
          .prepare(`DELETE FROM sessions WHERE token IN
          (SELECT a.token FROM artifact_sessions a JOIN artifact_feed_grants f ON f.token=a.token WHERE a.parent=? AND f.publication=? AND a.audience=?)`)
          .run(parent, publicationId, audience)
        this.db
          .prepare('DELETE FROM artifact_sessions WHERE token NOT IN (SELECT token FROM sessions)')
          .run()
        this.db
          .prepare(
            'DELETE FROM artifact_feed_grants WHERE token NOT IN (SELECT token FROM sessions)',
          )
          .run()
      }
      const count = this.db
        .prepare(`SELECT count(*) AS n FROM artifact_sessions a
        LEFT JOIN artifact_feed_grants f ON f.token=a.token WHERE a.parent=? AND (f.token IS NOT NULL)=?`)
        .get(parent, publicationId ? 1 : 0)
      if (Number(count?.n) >= 32)
        throw new RequestError(429, 'Too many active artifact sessions. Try again later.')
      this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(grant), user, expiresAt)
      this.db
        .prepare('INSERT INTO artifact_sessions VALUES(?,?,?)')
        .run(hash(grant), audience, parent)
      if (publicationId)
        this.db
          .prepare('INSERT INTO artifact_feed_grants VALUES(?,?)')
          .run(hash(grant), publicationId)
      else if (purpose)
        this.db
          .prepare('INSERT INTO reusable_grants VALUES(?,?,?)')
          .run(hash(grant), nonce, purpose)
      this.db.exec('COMMIT')
      return {
        token: grant,
        expiresAt,
        origin: audience,
        ...(publicationId ? { publicationId } : {}),
      }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  artifactSession(token: string, feed = false) {
    const row = this.db
      .prepare(`SELECT s.user,s.expires,a.audience,u.name,f.publication
      FROM artifact_sessions a JOIN sessions s ON s.token=a.token JOIN users u ON u.id=s.user
      LEFT JOIN artifact_feed_grants f ON f.token=a.token
      WHERE a.token=? AND s.expires>? AND (a.parent IS NULL OR EXISTS
      (SELECT 1 FROM sessions p WHERE p.token=a.parent AND p.expires>?))`)
      .get(hash(token), this.now(), this.now())
    if (
      typeof row?.user !== 'string' ||
      typeof row.name !== 'string' ||
      typeof row.expires !== 'number' ||
      typeof row.audience !== 'string' ||
      feed !== (typeof row.publication === 'string') ||
      this.deleting(row.user)
    )
      return
    const organization = this.organizationSession(hash(token))
    return {
      audience: row.audience,
      expiresAt: row.expires,
      sharingOrganizations: this.people.memberships(row.user),
      user: { id: row.user, name: row.name, ...(organization ? { organization } : {}) },
      ...(typeof row.publication === 'string' ? { publicationId: row.publication } : {}),
    }
  }
  artifactOwnerActive(user: string) {
    return !this.deleting(user) && !!this.db.prepare('SELECT 1 FROM users WHERE id=?').get(user)
  }
  directory(token: string, allowDeleting = false): AccountDirectory | undefined {
    const id = this.sessionUser(token, allowDeleting)
    if (!id) return
    const user = this.db.prepare('SELECT id,name FROM users WHERE id=?').get(id)
    if (!user || typeof user.id !== 'string' || typeof user.name !== 'string') return
    const servers = this.db
      .prepare('SELECT id,name,address FROM servers WHERE user=? ORDER BY name,id')
      .all(user.id)
      .map((row) => ({ id: String(row.id), name: String(row.name), address: String(row.address) }))
    const organization = this.organizationSession(hash(token))
    return {
      user: { id: user.id, name: user.name, ...(organization ? { organization } : {}) },
      servers,
    }
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
  /**
   * Keeps the raw subject only until deletion finishes, so Connect can retry without a session.
   * Runs at every start. A Connect version from before this table records a started deletion only
   * as a hashed marker, also after a rollback once the table exists. A user row with a marker is
   * a deletion that never finished, so it gets a pending row. Users that finished deletion have no
   * row and keep only their marker. Existing pending rows keep their retry order.
   */
  private migratePendingDeletions() {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.exec(
        'CREATE TABLE IF NOT EXISTS pending_account_deletions(user TEXT PRIMARY KEY,attempted INTEGER NOT NULL DEFAULT 0)',
      )
      const insert = this.db.prepare(
        'INSERT OR IGNORE INTO pending_account_deletions(user) VALUES(?)',
      )
      for (const row of this.db
        .prepare(
          'SELECT id FROM users WHERE id NOT IN (SELECT user FROM pending_account_deletions)',
        )
        .all())
        if (typeof row.id === 'string' && this.deleting(row.id)) insert.run(row.id)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  deleting(user: string) {
    return !!this.db.prepare('SELECT id FROM deleted_accounts WHERE id=?').get(hash(user))
  }
  beginDeletion(user: string) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('INSERT OR IGNORE INTO deleted_accounts(id) VALUES(?)').run(hash(user))
      this.db.prepare('INSERT OR IGNORE INTO pending_account_deletions(user) VALUES(?)').run(user)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  /** Least recently attempted first, so one failing account cannot block the others. */
  pendingDeletions(): string[] {
    return this.db
      .prepare('SELECT user FROM pending_account_deletions ORDER BY attempted,user')
      .all()
      .flatMap((row) => (typeof row.user === 'string' ? [row.user] : []))
  }
  deletionPending(user: string) {
    return !!this.db.prepare('SELECT 1 FROM pending_account_deletions WHERE user=?').get(user)
  }
  attemptDeletion(user: string) {
    this.db
      .prepare('UPDATE pending_account_deletions SET attempted=? WHERE user=?')
      .run(this.now(), user)
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
      this.db.prepare('INSERT OR IGNORE INTO deleted_accounts(id) VALUES(?)').run(hash(user))
      this.db.prepare('DELETE FROM pending_account_deletions WHERE user=?').run(user)
      this.people.deleteAccount(user)
      this.db.prepare('DELETE FROM sessions WHERE user=?').run(user)
      this.db.prepare('DELETE FROM servers WHERE user=?').run(user)
      // Internet tables are optional for stores opened by offline maintenance tools.
      for (const table of [
        'internet_requests',
        'internet_hosts',
        'internet_blocks',
        'sharing_key_sync',
        'sharing_key_identity',
        'sharing_key_recovery',
        'remote_mcp_grants',
      ]) {
        if (
          this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)
        )
          this.db.prepare(`DELETE FROM ${table} WHERE user=?`).run(user)
      }
      for (const [table, path] of [
        ['remote_mcp_browser', '$.user'],
        ['remote_mcp_codes', '$.grant.user'],
      ]) {
        if (
          this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)
        )
          this.db.prepare(`DELETE FROM ${table} WHERE json_extract(value,?)=?`).run(path, user)
      }
      this.db.prepare('DELETE FROM users WHERE id=?').run(user)
      this.db.prepare('DELETE FROM organization_identities WHERE user=?').run(user)
      this.db
        .prepare(
          'DELETE FROM organization_sessions WHERE token NOT IN (SELECT token FROM sessions)',
        )
        .run()
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
