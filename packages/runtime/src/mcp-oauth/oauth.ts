import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import type { OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js'
import {
  decode,
  mutableStruct,
  type McpOAuthFlow,
  type McpOAuthFlowState,
  type McpOAuthServer,
  type McpOAuthStatus,
  type McpServer,
} from '@dovo/protocol'
import { HttpError } from '../errors.js'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'

const FLOW_MS = 10 * 60_000
const REQUEST_MS = 15_000

/** Stored on this computer only. Never projected into snapshots, settings or activity. */
const credentialSchema = mutableStruct({
  name: Schema.String,
  url: Schema.String,
  connectionId: Schema.optional(Schema.String),
  redirectUri: Schema.optional(Schema.String),
  clientInformation: Schema.optional(Schema.Unknown),
  tokens: Schema.optional(Schema.Unknown),
  expiresAt: Schema.optional(Schema.String),
  needsSignIn: Schema.optional(Schema.Literal(true)),
  discoveryState: Schema.optional(Schema.Unknown),
  connectedAt: Schema.optional(Schema.String),
})
type Credential = typeof credentialSchema.Type

const tokenFieldsSchema = mutableStruct({
  access_token: Schema.String,
  refresh_token: Schema.optional(Schema.String),
  scope: Schema.optional(Schema.String),
})

/** One connection per server name and exact URL on this computer. */
export function mcpOAuthKey(server: Pick<McpOAuthServer, 'name' | 'url'>) {
  return createHash('sha256')
    .update(`${server.name}\n${new URL(server.url).href}`)
    .digest('hex')
}

/** OAuth requests never follow redirects and always time out. */
const oauthFetch = (input: string | URL, init?: RequestInit) =>
  fetch(input, {
    ...init,
    redirect: 'error',
    signal: init?.signal ?? AbortSignal.timeout(REQUEST_MS),
  })

/** Reported to the harness as a tool error, so the agent can tell the person what to do. */
export class McpOAuthRequired extends McpError {
  constructor(name: string) {
    super(
      ErrorCode.InvalidRequest,
      `Sign in to the MCP server ${name} again in Settings → MCP, skills & hooks.`,
    )
  }
}

type FlowStatus = McpOAuthFlowState['state']
interface Flow {
  id: string
  key: string
  server: McpOAuthServer
  state: string
  redirectUri: string
  expiresAt: number
  status: FlowStatus
  /** Set when one callback starts exchanging the code. */
  claimed?: boolean
  error?: string
  verifier?: string
  clientInformation?: OAuthClientInformationMixed
  discoveryState?: OAuthDiscoveryState
  listener: Server
  timer: NodeJS.Timeout
}

class StoredProvider implements OAuthClientProvider {
  constructor(
    protected readonly store: McpOAuth,
    protected readonly key: string,
    protected readonly server: Pick<McpOAuthServer, 'name' | 'url' | 'scope'>,
    private readonly connectionId?: string,
  ) {}
  private current() {
    const saved = this.store.read(this.key)
    return saved?.connectionId === this.connectionId ? saved : undefined
  }
  private requireCurrent() {
    if (!this.current()) throw new McpOAuthRequired(this.server.name)
  }
  get redirectUrl(): string | undefined {
    // Refresh needs the registered redirect; an undefined value selects client_credentials.
    return this.current()?.redirectUri
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Dovo Studio',
      redirect_uris: this.redirectUrl ? [this.redirectUrl] : [],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      ...(this.server.scope ? { scope: this.server.scope } : {}),
    }
  }
  clientInformation() {
    return this.current()?.clientInformation as OAuthClientInformationMixed | undefined
  }
  saveClientInformation(clientInformation: OAuthClientInformationMixed) {
    this.requireCurrent()
    this.store.update(this.key, this.server, { clientInformation })
  }
  tokens() {
    return this.current()?.tokens as OAuthTokens | undefined
  }
  saveTokens(tokens: OAuthTokens) {
    this.requireCurrent()
    this.store.saveTokens(this.key, this.server, tokens)
  }
  redirectToAuthorization(_url: URL): void {
    // A running agent can refresh tokens but never starts a consent flow.
    if (this.current()) this.store.update(this.key, this.server, { needsSignIn: true })
    throw new McpOAuthRequired(this.server.name)
  }
  saveCodeVerifier(_verifier: string) {}
  state?(): string
  codeVerifier(): string {
    throw new McpOAuthRequired(this.server.name)
  }
  discoveryState() {
    return this.current()?.discoveryState as OAuthDiscoveryState | undefined
  }
  saveDiscoveryState(discoveryState: OAuthDiscoveryState) {
    this.requireCurrent()
    this.store.update(this.key, this.server, { discoveryState })
  }
  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'verifier' || !this.current()) return
    this.store.update(this.key, this.server, {
      ...(scope === 'all' || scope === 'tokens' ? { tokens: undefined, expiresAt: undefined } : {}),
      ...(scope === 'all' || scope === 'client' ? { clientInformation: undefined } : {}),
      ...(scope === 'all' || scope === 'discovery' ? { discoveryState: undefined } : {}),
    })
  }
}

/** Interactive sign-in: always shows consent and keeps the pending client until the code returns. */
class FlowProvider extends StoredProvider {
  constructor(
    store: McpOAuth,
    private readonly flow: Flow,
    private readonly onRedirect: (url: URL) => void,
  ) {
    super(store, flow.key, flow.server)
  }
  override get redirectUrl() {
    return this.flow.redirectUri
  }
  override clientInformation() {
    if (this.flow.clientInformation) return this.flow.clientInformation
    const saved = this.store.read(this.key)
    // A client registered for another loopback port cannot receive this flow's callback.
    return saved?.redirectUri === this.flow.redirectUri
      ? (saved.clientInformation as OAuthClientInformationMixed | undefined)
      : undefined
  }
  override saveClientInformation(clientInformation: OAuthClientInformationMixed) {
    this.flow.clientInformation = clientInformation
  }
  override tokens() {
    return undefined
  }
  override saveTokens(tokens: OAuthTokens) {
    if (this.flow.status !== 'pending') throw new Error('This sign-in has ended')
    this.store.saveTokens(this.key, this.server, tokens, {
      connectionId: this.flow.id,
      redirectUri: this.flow.redirectUri,
      clientInformation: this.flow.clientInformation ?? this.clientInformation(),
      discoveryState: this.flow.discoveryState,
    })
  }
  override discoveryState() {
    return this.flow.discoveryState
  }
  override saveDiscoveryState(discoveryState: OAuthDiscoveryState) {
    this.flow.discoveryState = discoveryState
  }
  override invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all' || scope === 'client') this.flow.clientInformation = undefined
    if (scope === 'all' || scope === 'discovery') this.flow.discoveryState = undefined
    if (scope === 'verifier') this.flow.verifier = undefined
  }
  override state() {
    return this.flow.state
  }
  override redirectToAuthorization(url: URL) {
    this.onRedirect(url)
  }
  override saveCodeVerifier(verifier: string) {
    this.flow.verifier = verifier
  }
  override codeVerifier() {
    if (!this.flow.verifier) throw new Error('Start the sign-in again')
    return this.flow.verifier
  }
}

export class McpOAuth {
  private readonly flows = new Map<string, Flow>()
  constructor(
    private readonly db: Database.Database,
    private readonly now = () => Date.now(),
  ) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS mcp_oauth_credentials (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
    )
  }
  read(key: string): Credential | undefined {
    const value = this.db
      .prepare('SELECT value FROM mcp_oauth_credentials WHERE key=?')
      .pluck()
      .get(key)
    return typeof value === 'string' ? decode(credentialSchema, JSON.parse(value)) : undefined
  }
  update(key: string, server: Pick<McpOAuthServer, 'name' | 'url'>, changes: Partial<Credential>) {
    const next = { ...this.read(key), name: server.name, url: server.url, ...changes }
    this.db
      .prepare(
        'INSERT INTO mcp_oauth_credentials VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, JSON.stringify(next))
  }
  saveTokens(
    key: string,
    server: Pick<McpOAuthServer, 'name' | 'url'>,
    tokens: OAuthTokens,
    connection?: Pick<
      Credential,
      'connectionId' | 'redirectUri' | 'clientInformation' | 'discoveryState'
    >,
  ) {
    const current = connection ? undefined : this.read(key)
    const previous = current?.tokens as OAuthTokens | undefined
    // Providers may omit the refresh token on refresh; keep the existing one in that case.
    const saved = {
      ...tokens,
      refresh_token: tokens.refresh_token ?? previous?.refresh_token,
    }
    this.update(key, server, {
      ...connection,
      tokens: saved,
      needsSignIn: undefined,
      expiresAt:
        tokens.expires_in === undefined
          ? undefined
          : new Date(this.now() + tokens.expires_in * 1000).toISOString(),
      connectedAt: current?.connectedAt ?? new Date(this.now()).toISOString(),
    })
  }

  /** The provider for runtime MCP clients. It refreshes tokens and never prompts. */
  provider(server: McpServer): OAuthClientProvider | undefined {
    if (!server.oauth || server.transport !== 'http') return undefined
    const target = { name: server.name, url: server.url, scope: server.oauth.scope }
    const key = mcpOAuthKey(target)
    const saved = this.read(key)
    if (!saved?.tokens || saved.needsSignIn) throw new McpOAuthRequired(server.name)
    return new StoredProvider(this, key, target, saved.connectionId)
  }

  connectionId(server: McpServer) {
    if (!server.oauth || server.transport !== 'http') return undefined
    const saved = this.read(mcpOAuthKey(server))
    if (!saved?.tokens || saved.needsSignIn) throw new McpOAuthRequired(server.name)
    return saved.connectionId ?? 'legacy'
  }

  status(servers: McpOAuthServer[]): McpOAuthStatus[] {
    return servers.map((server) => {
      const saved = this.read(mcpOAuthKey(server))
      const tokens = saved?.tokens ? decode(tokenFieldsSchema, saved.tokens) : undefined
      const expired =
        saved?.needsSignIn ||
        (!!saved?.expiresAt && Date.parse(saved.expiresAt) <= this.now() && !tokens?.refresh_token)
      return {
        name: server.name,
        url: server.url,
        state: !tokens ? 'disconnected' : expired ? 'expired' : 'connected',
        refreshable: !!tokens?.refresh_token,
        ...(saved?.expiresAt ? { expiresAt: saved.expiresAt } : {}),
        ...(tokens?.scope ? { scope: tokens.scope } : {}),
        ...(saved?.connectedAt && tokens ? { connectedAt: saved.connectedAt } : {}),
      }
    })
  }

  async connect(server: McpOAuthServer): Promise<McpOAuthFlow> {
    const url = new URL(server.url)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new HttpError(400, 'Enter an HTTP(S) server URL without embedded credentials')
    const key = mcpOAuthKey(server)
    const listener = createServer()
    await new Promise<void>((resolve, reject) => {
      listener.once('error', reject)
      listener.listen(0, '127.0.0.1', resolve)
    })
    const address = listener.address()
    if (!address || typeof address === 'string') throw new Error('No loopback port')
    // Register the new listener and replace the previous flow in one synchronous step.
    for (const flow of this.flows.values())
      if (flow.key === key && flow.status === 'pending') this.finish(flow, 'cancelled')
    const flow: Flow = {
      id: randomUUID(),
      key,
      server,
      state: randomBytes(24).toString('base64url'),
      redirectUri: `http://127.0.0.1:${address.port}/callback`,
      expiresAt: this.now() + FLOW_MS,
      status: 'pending',
      listener,
      timer: setTimeout(() => this.finish(flow, 'expired', 'Sign-in expired'), FLOW_MS),
    }
    flow.timer.unref?.()
    this.flows.set(flow.id, flow)
    listener.on('request', (request, response) => {
      const callback = new URL(request.url ?? '/', flow.redirectUri)
      if (request.method !== 'GET' || callback.pathname !== '/callback') {
        response.writeHead(404).end()
        return
      }
      void this.complete(flow.id, callback.href).then(
        (result) => {
          response.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'Content-Security-Policy': "default-src 'none'",
          })
          response.end(
            result.state === 'connected'
              ? '<!doctype html><title>Dovo Studio</title><p>Signed in. You can close this window and return to Dovo Studio.</p>'
              : '<!doctype html><title>Dovo Studio</title><p>Sign-in did not complete. Return to Dovo Studio for details.</p>',
          )
        },
        () => response.writeHead(400).end(),
      )
    })
    let authorizationUrl: URL | undefined
    try {
      const result = await auth(
        new FlowProvider(this, flow, (url) => {
          authorizationUrl = url
        }),
        { serverUrl: server.url, scope: server.scope, fetchFn: oauthFetch },
      )
      if (result !== 'REDIRECT' || !authorizationUrl)
        throw new Error('The server did not request a browser sign-in')
    } catch (error) {
      if (flow.status !== 'pending') throw new HttpError(409, 'This sign-in has ended.')
      this.finish(flow, 'failed', oauthError(error))
      throw new HttpError(502, `Could not start sign-in: ${oauthError(error)}`)
    }
    if (flow.status !== 'pending') throw new HttpError(409, 'This sign-in has ended.')
    return {
      flowId: flow.id,
      authorizationUrl: authorizationUrl.href,
      redirectUri: flow.redirectUri,
      expiresAt: new Date(flow.expiresAt).toISOString(),
    }
  }

  flow(flowId: string): McpOAuthFlowState {
    const flow = this.flows.get(flowId)
    if (!flow) return { flowId, state: 'expired' }
    return { flowId, state: flow.status, ...(flow.error ? { error: flow.error } : {}) }
  }

  /** Completes from the loopback listener or from a pasted browser address. */
  async complete(flowId: string, callbackUrl: string): Promise<McpOAuthFlowState> {
    const flow = this.flows.get(flowId)
    if (!flow) throw new HttpError(404, 'This sign-in expired. Select Connect again.')
    if (flow.status !== 'pending' || flow.claimed) return this.flow(flowId)
    let callback: URL
    try {
      callback = new URL(callbackUrl.trim())
    } catch {
      throw new HttpError(400, 'Paste the full address from the browser after sign-in')
    }
    const expected = new URL(flow.redirectUri)
    if (
      callback.protocol !== 'http:' ||
      callback.host !== expected.host ||
      callback.pathname !== expected.pathname ||
      callback.username ||
      callback.password
    )
      throw new HttpError(400, `Paste the browser address that starts with ${flow.redirectUri}`)
    if (callback.searchParams.get('state') !== flow.state)
      throw new HttpError(400, 'This address belongs to a different sign-in')
    const denied = callback.searchParams.get('error')
    if (denied) {
      this.finish(flow, 'failed', `The provider returned ${denied.slice(0, 80)}`)
      return this.flow(flowId)
    }
    const code = callback.searchParams.get('code')
    if (!code) throw new HttpError(400, 'The address has no authorization code')
    // Claim the code once, so a pasted address and the loopback request cannot both exchange it.
    flow.claimed = true
    try {
      const result = await auth(new FlowProvider(this, flow, () => {}), {
        serverUrl: flow.server.url,
        scope: flow.server.scope,
        authorizationCode: code,
        fetchFn: oauthFetch,
      })
      if (result !== 'AUTHORIZED') throw new Error('The provider did not issue a token')
      if (flow.status === 'pending') this.finish(flow, 'connected')
    } catch (error) {
      if (flow.status === 'pending') this.finish(flow, 'failed', oauthError(error))
    }
    return this.flow(flowId)
  }

  cancel(flowId: string) {
    const flow = this.flows.get(flowId)
    if (flow?.status === 'pending') this.finish(flow, 'cancelled')
    return this.flow(flowId)
  }

  /** Removes the local connection and asks the provider to revoke it when it supports that. */
  async disconnect(server: McpOAuthServer) {
    const key = mcpOAuthKey(server)
    for (const flow of this.flows.values())
      if (flow.key === key && flow.status === 'pending') this.finish(flow, 'cancelled')
    const saved = this.read(key)
    this.db.prepare('DELETE FROM mcp_oauth_credentials WHERE key=?').run(key)
    let revoked = false
    const tokens = saved?.tokens ? decode(tokenFieldsSchema, saved.tokens) : undefined
    const endpoint = revocationEndpoint(saved?.discoveryState)
    const clientId = clientIdOf(saved?.clientInformation)
    if (tokens && endpoint && clientId) {
      revoked = true
      for (const [token, hint] of [
        [tokens.refresh_token, 'refresh_token'],
        [tokens.access_token, 'access_token'],
      ] as const) {
        if (!token) continue
        const response = await oauthFetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token, token_type_hint: hint, client_id: clientId }),
        }).catch(() => undefined)
        await response?.body?.cancel()
        if (!response?.ok) revoked = false
      }
    }
    return { revoked }
  }

  close() {
    for (const flow of this.flows.values()) this.finish(flow, 'cancelled')
  }

  private finish(flow: Flow, status: Exclude<FlowStatus, 'pending'>, error?: string) {
    flow.status = status
    flow.error = error
    flow.verifier = undefined
    clearTimeout(flow.timer)
    // Stop new connections; an in-flight callback still receives its page.
    flow.listener.close()
    flow.listener.closeIdleConnections?.()
    // Keep the final state briefly so the client can read it, then forget the flow.
    const forget = setTimeout(() => this.flows.delete(flow.id), FLOW_MS)
    forget.unref?.()
  }
}

function revocationEndpoint(discoveryState: unknown) {
  const metadata =
    discoveryState && typeof discoveryState === 'object'
      ? (discoveryState as OAuthDiscoveryState).authorizationServerMetadata
      : undefined
  const endpoint = metadata && 'revocation_endpoint' in metadata && metadata.revocation_endpoint
  return typeof endpoint === 'string' ? endpoint : undefined
}

function clientIdOf(information: unknown) {
  return information && typeof information === 'object' && 'client_id' in information
    ? String(information.client_id)
    : undefined
}

/** Provider errors can echo request data; keep the class and a bounded description only. */
function oauthError(error: unknown) {
  if (error instanceof McpOAuthRequired) return error.message
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/[A-Za-z0-9._~+/-]{32,}=*/g, '[redacted]').slice(0, 300)
}
