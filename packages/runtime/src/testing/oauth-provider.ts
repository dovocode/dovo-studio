import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

/**
 * A local OAuth 2.1 authorization server and protected MCP server for tests. It implements
 * RFC 9728 discovery, dynamic client registration, S256 PKCE, rotating refresh tokens and RFC
 * 7009 revocation. `/authorize` approves at once, as if the person selected Allow.
 */
export async function simulatedOAuthProvider(options: { accessSeconds?: number } = {}) {
  const clients = new Map<string, { redirectUris: string[] }>()
  const codes = new Map<string, { clientId: string; challenge: string; redirectUri: string }>()
  const access = new Map<string, { expiresAt: number; subject: string }>()
  const refresh = new Map<string, string>()
  const events: string[] = []
  const bearerSeen: string[] = []
  let now = () => Date.now()
  let deny = false
  let beforeExchange: (() => Promise<void>) | undefined
  const read = async (request: IncomingMessage) => {
    let text = ''
    for await (const chunk of request) text += String(chunk)
    return text
  }
  const json = (response: ServerResponse, status: number, value: unknown) =>
    response
      .writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      .end(JSON.stringify(value))
  const issue = (clientId: string) => {
    const token = randomBytes(24).toString('base64url')
    const refreshToken = randomBytes(24).toString('base64url')
    access.set(token, {
      expiresAt: now() + (options.accessSeconds ?? 3600) * 1000,
      subject: `user-of-${clientId}`,
    })
    refresh.set(refreshToken, clientId)
    return {
      access_token: token,
      token_type: 'Bearer',
      expires_in: options.accessSeconds ?? 3600,
      refresh_token: refreshToken,
      scope: 'mcp:tools',
    }
  }
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', origin)
      if (url.pathname.startsWith('/.well-known/oauth-protected-resource'))
        return json(response, 200, {
          resource: `${origin}/mcp`,
          authorization_servers: [origin],
          scopes_supported: ['mcp:tools'],
        })
      if (url.pathname === '/.well-known/oauth-authorization-server')
        return json(response, 200, {
          issuer: origin,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          registration_endpoint: `${origin}/register`,
          revocation_endpoint: `${origin}/revoke`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
        })
      if (url.pathname === '/register' && request.method === 'POST') {
        const body = JSON.parse(await read(request)) as { redirect_uris: string[] }
        const clientId = `client-${clients.size + 1}`
        clients.set(clientId, { redirectUris: body.redirect_uris })
        events.push('register')
        return json(response, 201, { ...body, client_id: clientId })
      }
      if (url.pathname === '/authorize') {
        const clientId = url.searchParams.get('client_id') ?? ''
        const redirectUri = url.searchParams.get('redirect_uri') ?? ''
        if (!clients.get(clientId)?.redirectUris.includes(redirectUri))
          return json(response, 400, { error: 'invalid_request' })
        if (url.searchParams.get('code_challenge_method') !== 'S256')
          return json(response, 400, { error: 'invalid_request' })
        const target = new URL(redirectUri)
        target.searchParams.set('state', url.searchParams.get('state') ?? '')
        if (deny) target.searchParams.set('error', 'access_denied')
        else {
          const code = randomBytes(16).toString('base64url')
          codes.set(code, {
            clientId,
            redirectUri,
            challenge: url.searchParams.get('code_challenge') ?? '',
          })
          target.searchParams.set('code', code)
        }
        events.push('authorize')
        return response.writeHead(302, { Location: target.href }).end()
      }
      if (url.pathname === '/token' && request.method === 'POST') {
        const form = new URLSearchParams(await read(request))
        if (form.get('grant_type') === 'authorization_code') {
          const code = codes.get(form.get('code') ?? '')
          codes.delete(form.get('code') ?? '')
          const verifier = form.get('code_verifier') ?? ''
          const challenge = createHash('sha256').update(verifier).digest('base64url')
          if (
            !code ||
            code.challenge !== challenge ||
            code.redirectUri !== form.get('redirect_uri') ||
            code.clientId !== form.get('client_id')
          )
            return json(response, 400, { error: 'invalid_grant' })
          await beforeExchange?.()
          events.push('token')
          return json(response, 200, issue(code.clientId))
        }
        if (form.get('grant_type') === 'refresh_token') {
          const clientId = refresh.get(form.get('refresh_token') ?? '')
          refresh.delete(form.get('refresh_token') ?? '')
          if (!clientId || clientId !== form.get('client_id'))
            return json(response, 400, { error: 'invalid_grant' })
          events.push('refresh')
          return json(response, 200, issue(clientId))
        }
        return json(response, 400, { error: 'unsupported_grant_type' })
      }
      if (url.pathname === '/revoke' && request.method === 'POST') {
        const form = new URLSearchParams(await read(request))
        const token = form.get('token') ?? ''
        access.delete(token)
        refresh.delete(token)
        events.push(`revoke:${form.get('token_type_hint')}`)
        return response.writeHead(200).end()
      }
      if (url.pathname === '/mcp') {
        const header = request.headers.authorization ?? ''
        const token = header.startsWith('Bearer ') ? header.slice(7) : ''
        const grant = access.get(token)
        if (!grant || grant.expiresAt <= now()) {
          request.resume()
          return response
            .writeHead(401, {
              'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
            })
            .end()
        }
        bearerSeen.push(token)
        const mcp = new Server(
          { name: 'oauth-fixture', version: '1' },
          { capabilities: { tools: {} } },
        )
        mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
          tools: [{ name: 'whoami', inputSchema: { type: 'object' } }],
        }))
        mcp.setRequestHandler(CallToolRequestSchema, async () => ({
          content: [{ type: 'text', text: grant.subject }],
        }))
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
        await mcp.connect(transport)
        response.on('close', () => void mcp.close())
        return transport.handleRequest(request, response)
      }
      response.writeHead(404).end()
    })().catch((error: unknown) => {
      if (!response.headersSent) json(response, 500, { error: String(error) })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No provider port')
  const origin = `http://127.0.0.1:${address.port}`
  return {
    url: `${origin}/mcp`,
    events,
    bearerSeen,
    access,
    setClock: (clock: () => number) => {
      now = clock
    },
    denyConsent: (value: boolean) => {
      deny = value
    },
    beforeExchange: (callback: () => Promise<void>) => {
      beforeExchange = callback
    },
    /** Follow the consent redirect as a browser would, without following it to the callback. */
    consent: async (authorizationUrl: string) => {
      const response = await fetch(authorizationUrl, { redirect: 'manual' })
      const location = response.headers.get('location')
      if (response.status !== 302 || !location) throw new Error('Consent did not redirect')
      return location
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
