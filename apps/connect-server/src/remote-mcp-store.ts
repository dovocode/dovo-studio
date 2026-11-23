import { hash, secret, type AccountStore, type Login, type RemoteMcpLogin } from './store.js'
import type { InternetStore } from './internet-store.js'
import { RequestError } from './http.js'
import type { RemoteMcpAccess } from '@dovo/protocol'

type Client = { id: string; runtimeId: string; name: string; redirects: string[] }
type Browser = {
  user: string
  parent: string
  browser: string
  intent: RemoteMcpLogin | 'manage'
  installation?: string
}
type Grant = {
  id: string
  user: string
  runtimeId: string
  installation: string
  parent: string
  clientId: string
  access: RemoteMcpAccess
  expires: number
}
type Code = { grant: Grant; redirect: string; challenge: string }
const hour = 3600_000
const loginLifetime = 5 * 60_000

export class RemoteMcpStore {
  constructor(
    private accounts: AccountStore,
    private internet: InternetStore,
  ) {
    accounts.db.exec(`
      CREATE TABLE IF NOT EXISTS remote_mcp_clients(id TEXT PRIMARY KEY, runtime TEXT NOT NULL, value TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS remote_mcp_browser(id TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS remote_mcp_codes(id TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS remote_mcp_grants(id TEXT PRIMARY KEY, user TEXT NOT NULL, value TEXT NOT NULL, access_hash TEXT NOT NULL UNIQUE, refresh_hash TEXT NOT NULL UNIQUE, access_expires INTEGER NOT NULL, expires INTEGER NOT NULL);`)
  }

  private cleanup() {
    const now = this.accounts.now()
    const db = this.accounts.db
    db.prepare('DELETE FROM remote_mcp_clients WHERE expires<=?').run(now)
    db.prepare('DELETE FROM remote_mcp_browser WHERE expires<=?').run(now)
    db.prepare('DELETE FROM remote_mcp_codes WHERE expires<=?').run(now)
    db.prepare('DELETE FROM remote_mcp_grants WHERE expires<=?').run(now)
  }

  register(runtimeId: string, name: string, redirects: string[]) {
    this.cleanup()
    const db = this.accounts.db
    const count = db
      .prepare('SELECT count(*) AS count FROM remote_mcp_clients WHERE runtime=?')
      .get(runtimeId)
    if (Number(count?.count) >= 250)
      throw new RequestError(429, 'Too many registrations for this computer.')
    const client = { id: secret(), runtimeId, name, redirects }
    db.prepare('INSERT INTO remote_mcp_clients VALUES(?,?,?,?)').run(
      client.id,
      runtimeId,
      JSON.stringify(client),
      this.accounts.now() + loginLifetime,
    )
    return client
  }

  client(runtimeId: string, id: string): Client | undefined {
    const row = this.accounts.db
      .prepare('SELECT value FROM remote_mcp_clients WHERE id=? AND runtime=? AND expires>?')
      .get(id, runtimeId, this.accounts.now())
    return typeof row?.value === 'string' ? JSON.parse(row.value) : undefined
  }

  browserSignIn(login: Login, user: string, installation?: string) {
    if (!login.remoteMcp || !login.browserHash) throw new RequestError(403, 'Invalid MCP sign-in.')
    this.accounts.db.prepare('INSERT INTO remote_mcp_browser VALUES(?,?,?)').run(
      login.id,
      JSON.stringify({
        user,
        parent: login.tokenHash,
        browser: login.browserHash,
        intent: login.remoteMcp,
        installation,
      } satisfies Browser),
      this.accounts.now() + loginLifetime,
    )
  }

  private parentActive(user: string, parent: string) {
    return (
      !this.accounts.deleting(user) &&
      !!this.accounts.db
        .prepare('SELECT 1 FROM sessions WHERE token=? AND user=? AND expires>?')
        .get(parent, user, this.accounts.now())
    )
  }

  browser(cookie: string): { id: string; browser: Browser } {
    const [id, browserToken] = cookie.split('.')
    const row = this.accounts.db
      .prepare('SELECT value FROM remote_mcp_browser WHERE id=? AND expires>?')
      .get(id || '', this.accounts.now())
    const browser: Browser | undefined =
      typeof row?.value === 'string' ? JSON.parse(row.value) : undefined
    if (
      !browser ||
      !browserToken ||
      browser.browser !== hash(browserToken) ||
      !this.parentActive(browser.user, browser.parent)
    )
      throw new RequestError(403, 'Connect sign-in expired. Start again.')
    return { id, browser }
  }

  approval(cookie: string, access: RemoteMcpAccess, enabled: (installation: string) => boolean) {
    const { id, browser } = this.browser(cookie)
    const intent = browser.intent
    if (intent === 'manage') throw new RequestError(400, 'This sign-in manages integrations.')
    const client = this.client(intent.runtimeId, intent.clientId)
    const installation = this.internet.installation(browser.user, intent.runtimeId)
    if (
      !client?.redirects.includes(intent.redirect) ||
      !installation ||
      installation.id !== browser.installation ||
      !enabled(installation.id)
    )
      throw new RequestError(403, 'This computer or app is no longer available.')
    const now = this.accounts.now()
    const grant = {
      id: secret(),
      user: browser.user,
      runtimeId: intent.runtimeId,
      installation: installation.id,
      parent: browser.parent,
      clientId: client.id,
      access,
      expires: now + 30 * 24 * hour,
    }
    const code = secret()
    const db = this.accounts.db
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare('DELETE FROM remote_mcp_browser WHERE id=?').run(id)
      db.prepare('UPDATE remote_mcp_clients SET expires=? WHERE id=?').run(grant.expires, client.id)
      db.prepare('INSERT INTO remote_mcp_codes VALUES(?,?,?)').run(
        hash(code),
        JSON.stringify({
          grant,
          challenge: intent.challenge,
          redirect: intent.redirect,
        } satisfies Code),
        now + 60_000,
      )
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    return { code, redirect: intent.redirect, state: intent.state }
  }

  active(grant: Grant) {
    return (
      grant.expires > this.accounts.now() &&
      this.parentActive(grant.user, grant.parent) &&
      this.internet.installation(grant.user, grant.runtimeId)?.id === grant.installation
    )
  }

  token(runtimeId: string, token: string): Grant | undefined {
    const row = this.accounts.db
      .prepare('SELECT value FROM remote_mcp_grants WHERE access_hash=? AND access_expires>?')
      .get(hash(token), this.accounts.now())
    const grant: Grant | undefined =
      typeof row?.value === 'string' ? JSON.parse(row.value) : undefined
    return grant?.runtimeId === runtimeId && this.active(grant) ? grant : undefined
  }

  grant(id: string): Grant | undefined {
    const row = this.accounts.db.prepare('SELECT value FROM remote_mcp_grants WHERE id=?').get(id)
    const grant: Grant | undefined =
      typeof row?.value === 'string' ? JSON.parse(row.value) : undefined
    return grant && this.active(grant) ? grant : undefined
  }

  exchange(runtimeId: string, clientId: string, code: string, redirect: string, verifier: string) {
    const db = this.accounts.db
    const key = hash(code)
    const row = db
      .prepare('SELECT value FROM remote_mcp_codes WHERE id=? AND expires>?')
      .get(key, this.accounts.now())
    const saved: Code | undefined =
      typeof row?.value === 'string' ? JSON.parse(row.value) : undefined
    if (
      !saved ||
      saved.grant.runtimeId !== runtimeId ||
      saved.grant.clientId !== clientId ||
      saved.redirect !== redirect ||
      saved.challenge !== hash(verifier) ||
      !this.active(saved.grant)
    )
      throw new RequestError(400, 'Authorization code or PKCE verifier is invalid.')
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare('DELETE FROM remote_mcp_codes WHERE id=?').run(key)
      const tokens = this.issue(saved.grant)
      db.exec('COMMIT')
      return tokens
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  refresh(runtimeId: string, clientId: string, refresh: string) {
    const row = this.accounts.db
      .prepare('SELECT value FROM remote_mcp_grants WHERE refresh_hash=?')
      .get(hash(refresh))
    const grant: Grant | undefined =
      typeof row?.value === 'string' ? JSON.parse(row.value) : undefined
    if (
      !grant ||
      grant.runtimeId !== runtimeId ||
      grant.clientId !== clientId ||
      !this.active(grant)
    )
      throw new RequestError(400, 'Refresh token expired or was revoked.')
    return this.issue(grant)
  }

  private issue(grant: Grant) {
    const access = secret(),
      refresh = secret()
    this.accounts.db
      .prepare('INSERT OR REPLACE INTO remote_mcp_grants VALUES(?,?,?,?,?,?,?)')
      .run(
        grant.id,
        grant.user,
        JSON.stringify(grant),
        hash(access),
        hash(refresh),
        this.accounts.now() + hour,
        grant.expires,
      )
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'dovo:studio',
    }
  }

  revokeToken(runtimeId: string, clientId: string, token: string) {
    this.accounts.db
      .prepare(
        "DELETE FROM remote_mcp_grants WHERE (access_hash=? OR refresh_hash=?) AND json_extract(value,'$.runtimeId')=? AND json_extract(value,'$.clientId')=?",
      )
      .run(hash(token), hash(token), runtimeId, clientId)
  }

  revoke(user: string, id: string) {
    this.accounts.db.prepare('DELETE FROM remote_mcp_grants WHERE id=? AND user=?').run(id, user)
  }

  list(user: string) {
    return this.accounts.db
      .prepare('SELECT value FROM remote_mcp_grants WHERE user=?')
      .all(user)
      .map((row) => JSON.parse(String(row.value)) as Grant)
      .filter((grant) => this.active(grant))
      .map(({ id, runtimeId, clientId, access }) => ({
        id,
        access,
        computer: this.internet.installation(user, runtimeId)?.name ?? runtimeId,
        app: this.client(runtimeId, clientId)?.name ?? 'External AI app',
      }))
  }
}
export type RemoteMcpGrant = NonNullable<ReturnType<RemoteMcpStore['grant']>>
