import type { IncomingMessage, ServerResponse } from 'node:http'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import { Schema } from 'effect'
import {
  decode,
  remoteMcpAccessSchema,
  remoteMcpAutomationsSchema,
  remoteMcpCommandSchema,
  remoteMcpDiscoverSchema,
  remoteMcpOfferSchema,
  remoteMcpReplySchema,
  remoteMcpReadThreadsSchema,
  remoteMcpReadAutomationsSchema,
  remoteMcpThreadsSchema,
} from '@dovo/protocol'
import { bearerToken, html, json, readBody, readJson, RequestError } from './http.js'
import type { InternetStore } from './internet-store.js'
import type { AccountStore, Login } from './store.js'
import { RemoteMcpMailbox } from './remote-mcp-mailbox.js'
import { RemoteMcpStore } from './remote-mcp-store.js'
import { remoteMcpConsent, remoteMcpManage } from './remote-mcp-pages.js'
import { nativeRemoteMcpRequest } from './remote-mcp-events.js'

const computerId = /^[a-zA-Z0-9_-]{1,200}$/
const pkceChallenge = /^[a-zA-Z0-9_-]{43}$/
const pkceVerifier = /^[a-zA-Z0-9._~-]{43,128}$/
const scope = 'dovo:studio'
function tool(name: string, description: string, schema: Schema.Constraint): Tool {
  const document = Schema.toJsonSchemaDocument(Schema.toType(schema), { onExcessProperty: 'error' })
  return {
    name,
    description,
    inputSchema: { ...document.schema, type: 'object', $defs: document.definitions },
  }
}

const tools = {
  discover: tool(
    'dovo_discover',
    'List projects and configured agents. Pass repositoryId and agentId for that agent’s models.',
    remoteMcpDiscoverSchema,
  ),
  threads: tool(
    'dovo_threads',
    'List and read threads. Create with a stable requestId, send follow-ups with a stable messageId, and stop or resume runs. ' +
      'For create and send, pass the user’s objective and explicit constraints. Use only skills enabled in Dovo Studio for the target agent and project. ' +
      'Let the receiving agent choose which skills to use. Omit skill names and paths from the calling app’s own environment. ' +
      'If the user explicitly requires a skill, pass its exact Studio name in requiredSkills. If the check fails, ask the user how to proceed.',
    remoteMcpThreadsSchema,
  ),
  automations: tool(
    'dovo_automations',
    'List, read and run existing automations. Supply a stable requestId to run. Existing review steps still apply.',
    remoteMcpAutomationsSchema,
  ),
}
const byName = new Map(Object.entries(tools).map(([part, tool]) => [tool.name, part]))
const readOnlyTools = [
  tools.discover,
  tool(
    'dovo_threads',
    'List threads and read messages or thread snapshots.',
    remoteMcpReadThreadsSchema,
  ),
  tool(
    'dovo_automations',
    'List and read automations and their runs.',
    remoteMcpReadAutomationsSchema,
  ),
].map((tool) => ({ ...tool, annotations: { readOnlyHint: true } }))

const redirect = (res: ServerResponse, location: string) => {
  res.writeHead(303, { Location: location })
  res.end()
}
async function form(req: IncomingMessage) {
  if (!req.headers['content-type']?.startsWith('application/x-www-form-urlencoded'))
    throw new RequestError(400, 'Use an OAuth form body.')
  const params = new URLSearchParams(await readBody(req))
  if (new Set(params.keys()).size !== [...params.keys()].length)
    throw new RequestError(400, 'Duplicate OAuth form fields.')
  return params
}

function trustedRedirect(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false
  try {
    const url = new URL(value)
    return (
      !url.username &&
      !url.password &&
      !url.hash &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)))
    )
  } catch {
    return false
  }
}

export class RemoteMcp {
  private store: RemoteMcpStore
  readonly mailbox: RemoteMcpMailbox
  private readonly secure: boolean
  private readonly cookieName: string

  constructor(
    private accounts: AccountStore,
    private internet: InternetStore,
    private origin: string,
  ) {
    if (!trustedRedirect(origin))
      throw new Error('Configure HTTPS for the Connect remote MCP origin.')
    this.store = new RemoteMcpStore(accounts, internet)
    this.mailbox = new RemoteMcpMailbox(this.store, accounts.now)
    this.secure = origin.startsWith('https:')
    this.cookieName = this.secure ? '__Host-dovo-login' : 'dovo-login'
  }

  private cookie(req: IncomingMessage) {
    return (
      (req.headers.cookie ?? '')
        .split(';')
        .map((value) => value.trim())
        .find((value) => value.startsWith(this.cookieName + '='))
        ?.slice(this.cookieName.length + 1) ?? ''
    )
  }

  private localForm(req: IncomingMessage) {
    if (req.headers.origin !== this.origin)
      throw new RequestError(403, 'Submit this form from Dovo Connect.')
    return form(req)
  }

  private manage(cookie: string) {
    const { browser } = this.store.browser(cookie)
    if (browser.intent !== 'manage') throw new RequestError(403, 'Sign in to manage integrations.')
    return {
      user: browser.user,
      page: remoteMcpManage(
        this.internet.directory(browser.user).flatMap(({ id, name }) => {
          const installation = this.internet.installation(browser.user, id)
          return computerId.test(id) && installation && this.mailbox.enabled(installation.id)
            ? [{ name, url: this.resource(id) }]
            : []
        }),
        this.store.list(browser.user),
      ),
    }
  }

  private login(res: ServerResponse, intent: NonNullable<Login['remoteMcp']>) {
    const { login } = this.accounts.createLogin()
    login.remoteMcp = intent
    this.accounts.saveLogin(login)
    redirect(res, '/auth/start?id=' + login.id)
  }

  signedIn(login: Login, user: string, req: IncomingMessage, res: ServerResponse) {
    const intent = login.remoteMcp
    if (!intent) throw new RequestError(400, 'Missing MCP authorization request.')
    if (intent === 'manage') {
      this.store.browserSignIn(login, user)
      return redirect(res, '/mcp/manage')
    }
    const client = this.store.client(intent.runtimeId, intent.clientId)
    const installation = this.internet.installation(user, intent.runtimeId)
    if (!client || !installation || !this.mailbox.enabled(installation.id))
      throw new RequestError(403, 'This computer is unavailable for MCP on your account.')
    this.store.browserSignIn(login, user, installation.id)
    this.store.browser(this.cookie(req))
    const callback = new URL(intent.redirect)
    // Browsers apply form-action to the approval form's redirect as well.
    const policy = res.getHeader('Content-Security-Policy')
    if (typeof policy === 'string')
      res.setHeader(
        'Content-Security-Policy',
        policy.replace(/form-action [^;]+/, `form-action 'self' ${callback.origin}`),
      )
    html(res, 200, remoteMcpConsent(installation.name, client.name, callback.host))
  }

  private resource(id: string) {
    return this.origin + '/mcp/' + id
  }
  private issuer(id: string) {
    return this.origin + '/mcp-oauth/' + id
  }

  async handle(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (url.pathname === '/mcp/manage' && req.method === 'GET') {
      try {
        html(res, 200, this.manage(this.cookie(req)).page)
      } catch (error) {
        if (!(error instanceof RequestError) || error.status !== 403) throw error
        this.login(res, 'manage')
      }
      return true
    }
    if (url.pathname === '/mcp/manage/revoke' && req.method === 'POST') {
      const input = await this.localForm(req)
      const { user } = this.manage(this.cookie(req))
      this.store.revoke(user, input.get('grant') ?? '')
      redirect(res, '/mcp/manage')
      return true
    }
    if (url.pathname === '/mcp/approve' && req.method === 'POST') {
      const input = await this.localForm(req)
      const {
        code,
        redirect: target,
        state,
      } = this.store.approval(
        this.cookie(req),
        decode(remoteMcpAccessSchema, input.get('access')),
        (installation) => this.mailbox.enabled(installation),
      )
      const location = new URL(target)
      location.searchParams.set('code', code)
      if (state !== undefined) location.searchParams.set('state', state)
      res.setHeader(
        'Set-Cookie',
        `${this.cookieName}=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/${this.secure ? '; Secure' : ''}`,
      )
      redirect(res, location.href)
      return true
    }
    const metadata = /^\/\.well-known\/oauth-protected-resource\/mcp\/([^/]+)$/.exec(url.pathname)
    const authorization = /^\/\.well-known\/oauth-authorization-server\/mcp-oauth\/([^/]+)$/.exec(
      url.pathname,
    )
    if (req.method === 'GET' && metadata && computerId.test(metadata[1])) {
      json(res, 200, {
        resource: this.resource(metadata[1]),
        authorization_servers: [this.issuer(metadata[1])],
        scopes_supported: [scope],
        bearer_methods_supported: ['header'],
      })
      return true
    }
    if (req.method === 'GET' && authorization && computerId.test(authorization[1])) {
      const issuer = this.issuer(authorization[1])
      json(res, 200, {
        issuer,
        authorization_endpoint: issuer + '/authorize',
        token_endpoint: issuer + '/token',
        registration_endpoint: issuer + '/register',
        revocation_endpoint: issuer + '/revoke',
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none'],
        revocation_endpoint_auth_methods_supported: ['none'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: [scope],
      })
      return true
    }
    const oauth = /^\/mcp-oauth\/([^/]+)\/(authorize|token|register|revoke)$/.exec(url.pathname)
    if (oauth && computerId.test(oauth[1])) {
      await this.oauth(req, res, url, oauth[1], oauth[2])
      return true
    }
    const mcp = /^\/mcp\/([^/]+)$/.exec(url.pathname)
    if (mcp && computerId.test(mcp[1])) {
      await this.toolRequest(req, res, mcp[1])
      return true
    }
    if (
      req.method === 'POST' &&
      ['/v1/internet/host/mcp/claim', '/v1/internet/host/mcp/reply'].includes(url.pathname)
    ) {
      const reply = url.pathname.endsWith('/reply')
      const input = await readJson(req, reply ? 262144 : 16384)
      const host = this.internet.host(bearerToken(req))
      if (!host) throw new RequestError(401, 'Internet access has been revoked.')
      if (reply) {
        this.mailbox.reply(host, decode(remoteMcpReplySchema, input))
        json(res, 200, { ok: true })
      } else json(res, 200, this.mailbox.claim(host, decode(remoteMcpOfferSchema, input).id))
      return true
    }
    return false
  }

  private async oauth(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    id: string,
    action: string,
  ) {
    try {
      if (action === 'register' && req.method === 'POST') {
        const input = decode(
          Schema.Struct({
            client_name: Schema.optional(Schema.String.check(Schema.isMaxLength(150))),
            redirect_uris: Schema.Array(Schema.String),
            token_endpoint_auth_method: Schema.optional(Schema.Literal('none')),
          }),
          await readJson(req),
        )
        if (
          !input.redirect_uris.length ||
          input.redirect_uris.length > 8 ||
          !input.redirect_uris.every(trustedRedirect)
        )
          throw new RequestError(400, 'Register an HTTPS or loopback callback URL.')
        const client = this.store.register(id, input.client_name?.trim() || 'External AI app', [
          ...input.redirect_uris,
        ])
        json(res, 201, {
          client_id: client.id,
          client_name: client.name,
          redirect_uris: client.redirects,
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
        })
        return
      }
      const params = req.method === 'GET' ? url.searchParams : await form(req)
      if (req.method === 'GET' && new Set(params.keys()).size !== [...params.keys()].length)
        throw new RequestError(400, 'Duplicate OAuth authorization fields.')
      const resource = params.get('resource')
      if (params.getAll('resource').length > 1 || (resource && resource !== this.resource(id)))
        throw new RequestError(400, 'The resource must match this MCP server URL.')
      const clientId = params.get('client_id') ?? ''
      if (action === 'authorize' && req.method === 'GET') {
        const client = this.store.client(id, clientId)
        const target = params.get('redirect_uri') ?? ''
        const challenge = params.get('code_challenge') ?? ''
        const state = params.get('state') ?? undefined
        if (
          params.get('response_type') !== 'code' ||
          params.get('code_challenge_method') !== 'S256' ||
          !pkceChallenge.test(challenge) ||
          !client?.redirects.includes(target) ||
          (state?.length ?? 0) > 1024 ||
          (params.has('scope') && params.get('scope') !== scope)
        )
          throw new RequestError(
            400,
            'Use the registered callback and authorization code with S256 PKCE.',
          )
        return this.login(res, { clientId, runtimeId: id, redirect: target, challenge, state })
      }
      if (action === 'token' && req.method === 'POST') {
        const type = params.get('grant_type')
        if (type === 'authorization_code') {
          const verifier = params.get('code_verifier') ?? ''
          if (!pkceVerifier.test(verifier))
            throw new RequestError(400, 'A valid PKCE verifier is required.')
          return json(
            res,
            200,
            this.store.exchange(
              id,
              clientId,
              params.get('code') ?? '',
              params.get('redirect_uri') ?? '',
              verifier,
            ),
          )
        }
        if (type === 'refresh_token')
          return json(res, 200, this.store.refresh(id, clientId, params.get('refresh_token') ?? ''))
        return json(res, 400, { error: 'unsupported_grant_type' })
      }
      if (action === 'revoke' && req.method === 'POST') {
        this.store.revokeToken(id, clientId, params.get('token') ?? '')
        return json(res, 200, {})
      }
      throw new RequestError(405, 'This OAuth endpoint does not support that method.')
    } catch (error) {
      if (error instanceof RequestError)
        return json(res, error.status, {
          error:
            action === 'token'
              ? 'invalid_grant'
              : action === 'register'
                ? 'invalid_client_metadata'
                : 'invalid_request',
          error_description: error.message,
        })
      throw error
    }
  }

  private async toolRequest(req: IncomingMessage, res: ServerResponse, id: string) {
    if (req.headers.origin && req.headers.origin !== this.origin)
      throw new RequestError(403, 'This origin cannot call the MCP endpoint directly.')
    const token = bearerToken(req)
    const grant = this.store.token(id, token)
    if (!grant) {
      res.setHeader(
        'WWW-Authenticate',
        `Bearer resource_metadata="${this.origin}/.well-known/oauth-protected-resource/mcp/${id}", scope="${scope}"`,
      )
      return json(res, 401, { error: 'Authorize this MCP connection.' })
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return json(res, 405, { error: 'This stateless MCP endpoint accepts POST requests.' })
    }
    const advertisedTools = grant.access === 'read' ? readOnlyTools : Object.values(tools)
    const body = await readJson(req, 65536)
    const controller = new AbortController()
    const abort = () => controller.abort()
    res.once('close', abort)
    let server: Server | undefined
    const activeGrant = () => {
      const active = this.store.token(id, token)
      if (!active) throw new RequestError(403, 'This MCP grant is no longer active.')
      return active
    }
    const callTool = async ({
      name,
      arguments: args,
    }: (typeof CallToolRequestSchema)['_output']['params']) => {
      try {
        const active = activeGrant()
        const input = Schema.decodeUnknownSync(remoteMcpCommandSchema, {
          onExcessProperty: 'error',
        })({
          part: byName.get(name),
          command: args ?? {},
        })
        const data = await this.mailbox.call(active, input, controller.signal)
        return { content: [{ type: 'text' as const, text: JSON.stringify(data ?? null) }] }
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text:
                error instanceof RequestError
                  ? error.message
                  : 'Invalid or unavailable Dovo Studio tool request.',
            },
          ],
          isError: true,
        }
      }
    }
    try {
      if (
        await nativeRemoteMcpRequest(req, res, body, {
          eventsEnabled: this.mailbox.eventsEnabled(grant.installation),
          tools: advertisedTools,
          callTool,
          poll: async (command) => {
            const page = await this.mailbox.call(
              activeGrant(),
              { part: 'events', command },
              controller.signal,
            )
            activeGrant()
            return page
          },
        })
      )
        return
      server = new Server(
        { name: 'dovo-connect', version: '1.0.0' },
        { capabilities: { tools: {} } },
      )
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })
      server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: advertisedTools,
      }))
      server.setRequestHandler(CallToolRequestSchema, async ({ params }) => callTool(params))
      await server.connect(transport)
      await transport.handleRequest(req, res, body)
    } finally {
      res.off('close', abort)
      await server?.close()
    }
  }
}
