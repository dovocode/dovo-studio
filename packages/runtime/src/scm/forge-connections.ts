import type Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  forgeConnectionSchema,
  forgeConnectionInputSchema,
  type ForgeConnection,
} from '@dovo/protocol'
import { HttpError } from '../errors.js'
import { ForgeHttp } from './forge-http.js'
import type { ForgeCliAccounts } from './forge-cli-accounts.js'
import { withinForgeServer } from './forge-url.js'

const storedSchema = forgeConnectionSchema.extend({
  token: z.string().optional(),
  environmentFingerprint: z.string().optional(),
  cliFingerprint: z.string().optional(),
})
function environmentFingerprint(tokenEnv: string | undefined) {
  return createHash('sha256')
    .update(JSON.stringify([tokenEnv, process.env[tokenEnv ?? ''] || null]))
    .digest('hex')
}
// Host-private storage, deliberately outside workspace snapshots and client read caches.
export class ForgeConnections {
  constructor(
    private db: Database.Database,
    private onRevision?: (id: string, revision: string) => void,
    private cli?: ForgeCliAccounts,
  ) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS forge_connections (id TEXT PRIMARY KEY, value TEXT NOT NULL)',
    )
    // Reconcile before clients can receive a workspace snapshot after restarting.
    this.rows()
  }
  private refreshEnvironment(row: z.infer<typeof storedSchema>) {
    if (row.credential !== 'environment') return row
    const fingerprint = environmentFingerprint(row.tokenEnv)
    if (row.environmentFingerprint === fingerprint) return row
    const next = { ...row, environmentFingerprint: fingerprint, revision: randomUUID() }
    this.db.transaction(() => {
      this.db
        .prepare('UPDATE forge_connections SET value=? WHERE id=?')
        .run(JSON.stringify(next), row.id)
      this.onRevision?.(row.id, next.revision)
    })()
    return next
  }
  private rows() {
    return z
      .array(z.object({ value: z.string() }))
      .parse(this.db.prepare('SELECT value FROM forge_connections ORDER BY id').all())
      .map((row) => this.refreshEnvironment(storedSchema.parse(JSON.parse(row.value))))
  }
  list(): ForgeConnection[] {
    return this.rows().map((row) => forgeConnectionSchema.parse(row))
  }
  get(id: string): ForgeConnection {
    const found = this.list().find((connection) => connection.id === id)
    if (!found) throw new HttpError(404, 'Source control connection not found')
    return found
  }
  save(value: unknown): ForgeConnection {
    const input = forgeConnectionInputSchema.parse(value)
    const old = input.id ? this.rows().find((row) => row.id === input.id) : undefined
    if (input.id && !old) throw new HttpError(404, 'Source control connection not found')
    if (input.provider === 'github' && input.credential !== 'gh')
      throw new HttpError(
        400,
        'Use GitHub CLI authentication on the runtime for GitHub connections',
      )
    const url = new URL(input.baseUrl)
    url.pathname = url.pathname.replace(/\/+$/, '')
    const baseUrl = url.toString().replace(/\/$/, '')
    if (
      input.provider === 'github' &&
      (url.protocol !== 'https:' || url.port !== '' || url.pathname !== '/')
    )
      throw new HttpError(400, 'Use an HTTPS GitHub hostname without a port or path')
    if (input.provider === 'bitbucket' && baseUrl !== 'https://api.bitbucket.org/2.0')
      throw new HttpError(
        400,
        'Bitbucket Cloud uses https://api.bitbucket.org/2.0. Bitbucket Data Center is not supported by this connection type.',
      )
    if (
      input.provider === 'azure-devops' &&
      (url.protocol !== 'https:' ||
        url.port !== '' ||
        url.hostname !== 'dev.azure.com' ||
        !/^\/[^/]+$/.test(url.pathname))
    )
      throw new HttpError(
        400,
        'Use https://dev.azure.com/your-organization for Azure DevOps Services',
      )
    // Changing the server/provider must never silently reuse a credential for another host.
    const reusable =
      old?.baseUrl === baseUrl && old.provider === input.provider && old.username === input.username
    const token =
      input.credential === 'token'
        ? (input.token ?? (reusable ? old?.token : undefined))
        : undefined
    if (input.credential === 'token' && !token)
      throw new HttpError(400, 'Enter an API token for this connection')
    const record = storedSchema.parse({
      ...input,
      baseUrl,
      token,
      environmentFingerprint:
        input.credential === 'environment' ? environmentFingerprint(input.tokenEnv) : undefined,
      id: input.id ?? randomUUID(),
      revision: randomUUID(),
    })
    this.db
      .prepare('INSERT OR REPLACE INTO forge_connections(id,value) VALUES(?,?)')
      .run(record.id, JSON.stringify(record))
    return forgeConnectionSchema.parse(record)
  }
  remove(id: string) {
    this.get(id)
    this.db.prepare('DELETE FROM forge_connections WHERE id=?').run(id)
  }
  secret(id: string) {
    const row = this.rows().find((item) => item.id === id)
    if (!row) throw new HttpError(404, 'Source control connection not found')
    const token = row.credential === 'environment' ? process.env[row.tokenEnv ?? ''] : row.token
    if (!token)
      throw new HttpError(
        400,
        row.credential === 'environment'
          ? `Set ${row.tokenEnv} on the runtime host, then restart the runtime`
          : 'Configure this connection’s API token',
      )
    return token
  }
  async reconcileCli(id: string, cwd?: string) {
    const row = this.rows().find((item) => item.id === id)
    if (!row || row.credential !== 'cli') return this.get(id)
    if (!this.cli) throw new HttpError(400, 'CLI accounts are not configured')
    const identity = await this.cli.identity(row, cwd)
    const cliFingerprint = createHash('sha256').update(identity).digest('hex')
    const current = this.rows().find((item) => item.id === id)
    if (
      !current ||
      (current.revision !== row.revision && current.cliFingerprint !== cliFingerprint)
    )
      throw new HttpError(409, 'This source control account changed. Refresh before continuing.')
    if (current.cliFingerprint !== cliFingerprint) {
      const next = { ...row, cliFingerprint, revision: randomUUID() }
      this.db.transaction(() => {
        this.db
          .prepare('UPDATE forge_connections SET value=? WHERE id=?')
          .run(JSON.stringify(next), id)
        this.onRevision?.(id, next.revision)
      })()
    }
    return this.get(id)
  }
  async githubToken(id: string, cwd?: string): Promise<string | undefined> {
    const connection = this.get(id)
    if (connection.provider !== 'github' || !connection.cliProfile) return undefined
    if (!this.cli) throw new HttpError(400, 'CLI accounts are not configured')
    return this.cli.githubToken(connection, cwd)
  }
  authorization(id: string, git = false, cwd?: string) {
    const connection = this.get(id)
    if (connection.credential === 'cli') {
      if (!this.cli) throw new HttpError(400, 'CLI accounts are not configured')
      if (['gitea', 'forgejo'].includes(connection.provider) && git) return ''
      return this.cli.authorization(connection, git, cwd)
    }
    const token = this.secret(id)
    if (connection.provider === 'bitbucket')
      return `Basic ${Buffer.from(`${git ? 'x-bitbucket-api-token-auth' : connection.username}:${token}`).toString('base64')}`
    if (connection.provider === 'azure-devops')
      return `Basic ${Buffer.from(`:${token}`).toString('base64')}`
    if (git)
      return `Basic ${Buffer.from(`${connection.username || 'oauth2'}:${token}`).toString('base64')}`
    return `token ${token}`
  }
  gitAuthorization(id: string, remote: string, cwd?: string) {
    const connection = this.get(id),
      url = new URL(remote)
    const base = new URL(
      connection.provider === 'bitbucket' ? 'https://bitbucket.org/' : `${connection.baseUrl}/`,
    )
    if (!withinForgeServer(url, base) || url.search || url.hash)
      throw new HttpError(
        400,
        'The Git remote is outside this source control connection. Check its clone URL before continuing.',
      )
    if (connection.provider === 'github')
      return this.githubToken(id, cwd).then((token) =>
        token ? `Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}` : '',
      )
    return this.authorization(id, true, cwd)
  }
}

export function connectionHttp(
  connections: ForgeConnections,
  connection: ForgeConnection,
  cwd?: string,
) {
  return new ForgeHttp(connection, () => {
    if (connections.get(connection.id).revision !== connection.revision)
      throw new HttpError(409, 'This source control account changed. Refresh before continuing.')
    return connections.authorization(connection.id, false, cwd)
  })
}
