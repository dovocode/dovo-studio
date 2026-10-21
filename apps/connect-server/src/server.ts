import type { DeleteIdentity } from './delete-identity.js'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { hash, type AccountStore } from './store.js'
import type { IdentityProvider } from './oidc.js'
import { bearerToken, json, RequestError } from './http.js'
import { browserAuth } from './browser-auth.js'
import { InternetStore } from './internet-store.js'
import { internetApi } from './internet-api.js'
import { accountApi } from './account-api.js'
import { pushApi } from './push-api.js'
import type { PushDelivery } from './push-relay.js'
import { ValidationError } from '@dovo/protocol'
import { rateLimit } from './rate-limit.js'
import { clientAddress } from './client-address.js'
import { PushStore } from './push-store.js'
import { attachPeerSignaling } from './peer-signaling.js'
import type { PeerRelayIssuer } from './relay-credentials.js'
import type { PeerRelayAdmission } from './relay-admission.js'
import type { PeerRelayProvider } from '@dovo/protocol'
import { organizationRelay, type Organization } from './organizations.js'
import { artifactApi, artifactServiceToken, type ArtifactService } from './artifact-api.js'

export function createConnectServer(
  options: {
    store: AccountStore
    origin: string
    push?: PushDelivery
    deleteIdentity?: DeleteIdentity
    trustedProxies?: readonly string[]
    peerRelays?: Partial<Record<PeerRelayProvider, PeerRelayIssuer>>
    peerRelayAdmission?: PeerRelayAdmission
    organizations?: readonly Organization[]
    artifacts?: ArtifactService
  } & IdentityProvider,
) {
  const origin = new URL(options.origin).origin
  options.store.configureOrganizations(
    new Map(
      (options.organizations ?? []).map((organization) => [organization.id, organization.policy]),
    ),
  )
  const identityOrigin = new URL(options.authorizationOrigin).origin
  const authenticate = browserAuth({ ...options, origin })
  const artifacts = artifactApi(options.store, origin, options.artifacts)
  const pushStore = new PushStore(options.store)
  const push = pushApi(options.store, pushStore, options.push)
  const internetStore = new InternetStore(options.store, origin)
  const internet = internetApi(internetStore, (host) =>
    organizationRelay(options.organizations ?? [], options.store, host),
  )
  const account = accountApi(options.store, origin, options.deleteIdentity, internetStore)
  const limit = rateLimit(options.store.now)
  const artifactLimit = rateLimit(options.store.now, 3000)
  const address = clientAddress(options.trustedProxies ?? [])
  let active = 0
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Referrer-Policy', 'same-origin')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; form-action 'self' ${[identityOrigin, ...(options.organizations ?? []).flatMap((organization) => [organization.provider.authorizationOrigin, ...organization.endpointOrigins])].join(' ')}; frame-ancestors 'none'; base-uri 'none'`,
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
      req.method === 'POST' &&
      ((url.pathname === '/v1/push/send' && pushStore.subscription(token)) ||
        (url.pathname === '/v1/push/activities/send' && pushStore.activity(token)))
    const internetHost = url.pathname.startsWith('/v1/internet/host')
      ? internetStore.host(token)
      : undefined
    const artifactUser = url.pathname.startsWith('/v1/artifacts/')
      ? (options.store.artifactSession(token) ?? options.store.artifactSession(token, true))?.user
          .id
      : undefined
    if (url.pathname === '/v1/artifacts/owners' && artifactServiceToken(token, options.artifacts))
      artifactLimit('artifact-service')
    else
      limit(
        artifactUser
          ? `artifact:${hash(artifactUser)}`
          : user
            ? `account:${hash(user)}`
            : internetHost
              ? `internet:${hash(token)}`
              : grant
                ? `push:${hash(token)}`
                : `ip:${address(req)}`,
      )
    if (await authenticate(req, res, url)) return
    if (await artifacts(req, res, url)) return
    if (await push(req, res, url)) return
    if (url.pathname.startsWith('/v1/internet/')) return internet(req, res, url)
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
  attachPeerSignaling(
    server,
    options.trustedProxies,
    options.peerRelays,
    (key, payload, signature) => options.peerRelayAdmission?.(key, payload, signature) ?? false,
    options.origin,
    (grant, identity) => internetStore.host(grant)?.identity === identity,
  )
  return server
}
