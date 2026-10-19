import type { DeleteIdentity } from './delete-identity.js'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { hash, type AccountStore } from './store.js'
import type { IdentityProvider } from './oidc.js'
import { bearerToken, json, RequestError } from './http.js'
import { browserAuth } from './browser-auth.js'
import { accountApi } from './account-api.js'
import { pushApi } from './push-api.js'
import type { PushDelivery } from './push-relay.js'
import { ValidationError } from '@dovo/protocol'
import { rateLimit } from './rate-limit.js'
import { clientAddress } from './client-address.js'
import { PushStore } from './push-store.js'

export function createConnectServer(
  options: {
    store: AccountStore
    origin: string
    push?: PushDelivery
    deleteIdentity?: DeleteIdentity
    trustedProxies?: readonly string[]
  } & IdentityProvider,
) {
  const origin = new URL(options.origin).origin
  const identityOrigin = new URL(options.authorizationOrigin).origin
  const authenticate = browserAuth({ ...options, origin })
  const pushStore = new PushStore(options.store)
  const push = pushApi(options.store, pushStore, options.push)
  const account = accountApi(options.store, origin, options.deleteIdentity)
  const limit = rateLimit(options.store.now)
  const address = clientAddress(options.trustedProxies ?? [])
  let active = 0
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Referrer-Policy', 'same-origin')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; form-action 'self' ${identityOrigin}; frame-ancestors 'none'; base-uri 'none'`,
    )
    const url = new URL(req.url ?? '/', origin)
    if (url.pathname.startsWith('/v1/')) {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    }
    if (req.method === 'OPTIONS') return json(res, 204, {})
    if (req.method === 'GET' && url.pathname === '/health')
      return json(res, 200, { ok: true, service: 'dovo-connect', accountRequired: false })
    const token = bearerToken(req)
    const user = options.store.sessionUser(token, true)
    const grant =
      req.method === 'POST' && url.pathname === '/v1/push/send' && pushStore.subscription(token)
    limit(user ? `account:${hash(user)}` : grant ? `push:${hash(token)}` : `ip:${address(req)}`)
    if (await authenticate(req, res, url)) return
    if (await push(req, res, url)) return
    return account(req, res, url)
  }
  const server = createServer((req, res) => {
    if (active >= 64) {
      json(res, 503, { error: 'Service is busy' })
      return
    }
    active++
    void handle(req, res)
      .catch((error) => {
        if (!res.headersSent)
          json(
            res,
            error instanceof RequestError
              ? error.status
              : error instanceof ValidationError
                ? 400
                : 502,
            {
              error:
                error instanceof ValidationError
                  ? 'Invalid request'
                  : error instanceof RequestError
                    ? error.message
                    : 'Account service could not complete this request. Try again.',
            },
          )
        else res.destroy()
      })
      .finally(() => active--)
  })
  server.requestTimeout = 15_000
  server.headersTimeout = 10_000
  server.maxHeadersCount = 40
  return server
}
