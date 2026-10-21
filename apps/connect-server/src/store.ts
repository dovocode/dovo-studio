import { DatabaseSync } from 'node:sqlite'
import { createHash, randomBytes } from 'node:crypto'
import type { AccountDirectory, AccountServer } from '@dovo/protocol'
import type { AccountIdentity } from './oidc.js'
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
  identityCookies?: string[]
  browserHash?: string
  organization?: string
  artifactsOrigin?: string
}
export class AccountStore {
  private organizations: ReadonlyMap<string, string> = new Map()
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
      CREATE TABLE IF NOT EXISTS organization_sessions(token TEXT PRIMARY KEY,organization TEXT NOT NULL,name TEXT NOT NULL,policy TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS organization_identities(user TEXT PRIMARY KEY,organization TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS servers(user TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,address TEXT NOT NULL,PRIMARY KEY(user,id));
      CREATE TABLE IF NOT EXISTS artifact_sessions(token TEXT PRIMARY KEY,audience TEXT NOT NULL,parent TEXT);
      CREATE TABLE IF NOT EXISTS artifact_feed_grants(token TEXT PRIMARY KEY,publication TEXT NOT NULL);`)
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
    if (this.deleting(user.id)) throw new Error('Account deletion has started')
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
  artifactGrant(token: string, audience: string, publicationId?: string) {
    this.cleanup()
    const directory = this.directory(token)
    if (!directory) return
    if (
      Number(
        this.db
          .prepare(`SELECT count(*) AS n FROM artifact_sessions a WHERE parent=? AND NOT EXISTS
            (SELECT 1 FROM artifact_feed_grants f WHERE f.token=a.token AND f.publication=? AND a.audience=?)`)
          .get(hash(token), publicationId ?? null, audience)?.n,
      ) >= 32
    )
      throw new Error('Too many active artifact sessions; try again later')
    const parent = this.db.prepare('SELECT expires FROM sessions WHERE token=?').get(hash(token))
    if (typeof parent?.expires !== 'number') return
    const grant = secret(),
      expiresAt = Math.min(this.now() + (publicationId ? 30 * 86400_000 : 600_000), parent.expires)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      if (publicationId) {
        // Reapproval replaces this parent's previous writer for the same publication.
        this.db
          .prepare(`DELETE FROM sessions WHERE token IN
          (SELECT a.token FROM artifact_sessions a JOIN artifact_feed_grants f ON f.token=a.token WHERE a.parent=? AND f.publication=? AND a.audience=?)`)
          .run(hash(token), publicationId, audience)
        this.db
          .prepare('DELETE FROM artifact_sessions WHERE token NOT IN (SELECT token FROM sessions)')
          .run()
        this.db
          .prepare(
            'DELETE FROM artifact_feed_grants WHERE token NOT IN (SELECT token FROM sessions)',
          )
          .run()
      }
      this.db
        .prepare('INSERT INTO sessions VALUES(?,?,?)')
        .run(hash(grant), directory.user.id, expiresAt)
      this.db
        .prepare('INSERT INTO artifact_sessions VALUES(?,?,?)')
        .run(hash(grant), audience, hash(token))
      if (publicationId)
        this.db
          .prepare('INSERT INTO artifact_feed_grants VALUES(?,?)')
          .run(hash(grant), publicationId)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return {
      token: grant,
      expiresAt,
      origin: audience,
      ...(publicationId ? { publicationId } : {}),
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
      // Internet tables are optional for stores opened by offline maintenance tools.
      for (const table of ['internet_requests', 'internet_hosts', 'internet_blocks']) {
        if (
          this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)
        )
          this.db.prepare(`DELETE FROM ${table} WHERE user=?`).run(user)
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
