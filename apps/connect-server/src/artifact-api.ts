import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { artifactServiceOrigin, decode, mutableStruct, uuidSchema } from '@dovo/protocol'
import type { AccountStore } from './store.js'
import { bearerToken, json, readJson, RequestError } from './http.js'

export type ArtifactService = { origin: string; key: string }
export function artifactServiceToken(token: string, service?: ArtifactService) {
  return (
    !!service &&
    token.length === service.key.length &&
    timingSafeEqual(Buffer.from(token), Buffer.from(service.key))
  )
}
export function artifactService(origin?: string, key?: string): ArtifactService | undefined {
  if (!origin && !key) return
  if (!origin || !key || !/^[A-Za-z0-9_-]{43}$/.test(key))
    throw new Error(
      'Configure DOVO_ARTIFACTS_ORIGIN and a 32-byte base64url DOVO_ARTIFACTS_SERVICE_KEY together',
    )
  return { origin: artifactServiceOrigin(origin), key }
}
export function artifactApi(store: AccountStore, connectOrigin: string, service?: ArtifactService) {
  return async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    if (!url.pathname.startsWith('/v1/artifacts/')) return false
    if (!service)
      throw new RequestError(
        503,
        'Hosted artifact sharing is not configured on this Connect broker',
      )
    const token = bearerToken(req)
    if (req.method === 'POST' && url.pathname === '/v1/artifacts/feed-session') {
      const { publicationId } = decode(
        mutableStruct({ publicationId: uuidSchema }),
        await readJson(req),
      )
      const grant = store.artifactGrant(token, service.origin, publicationId)
      if (!grant) throw new RequestError(401, 'Sign in to publish a data feed')
      json(res, 200, grant)
      return true
    }
    if (req.method === 'GET' && url.pathname === '/v1/artifacts/feed-session') {
      const session = store.artifactSession(token, true)
      if (session?.audience !== service.origin)
        throw new RequestError(401, 'Data feed session expired')
      json(res, 200, session)
      return true
    }
    if (req.method === 'GET' && url.pathname === '/v1/artifacts/service') {
      json(res, 200, { origin: service.origin })
      return true
    }
    if (req.method === 'POST' && url.pathname === '/v1/artifacts/login') {
      const { login, token: scopedToken } = store.createLogin(service.origin)
      json(res, 200, {
        token: scopedToken,
        code: login.code,
        url: connectOrigin + '/auth/start?id=' + login.id,
        expiresAt: login.expires,
      })
      return true
    }
    if (req.method === 'GET' && url.pathname === '/v1/artifacts/login') {
      if (store.artifactSession(token)?.audience === service.origin) json(res, 200, { ready: true })
      else if (store.pendingLogin(token)) json(res, 200, { ready: false })
      else throw new RequestError(401, 'Sign-in expired. Start again.')
      return true
    }
    if (req.method === 'POST' && url.pathname === '/v1/artifacts/session') {
      const grant = store.artifactGrant(token, service.origin)
      if (!grant) throw new RequestError(401, 'Sign in to publish artifacts')
      json(res, 200, grant)
      return true
    }
    if (req.method === 'GET' && url.pathname === '/v1/artifacts/session') {
      const session = store.artifactSession(token)
      if (session?.audience !== service.origin)
        throw new RequestError(401, 'Artifact sign-in expired')
      json(res, 200, session)
      return true
    }
    if (req.method === 'POST' && url.pathname === '/v1/artifacts/owners') {
      if (!artifactServiceToken(token, service))
        throw new RequestError(401, 'Invalid artifact service credential')
      const input = await readJson(req)
      if (
        !Array.isArray(input) ||
        input.length > 100 ||
        input.some((id) => typeof id !== 'string' || !id || id.length > 500)
      )
        throw new RequestError(400, 'Invalid owner list')
      json(
        res,
        200,
        input.map((id) => ({ id, active: store.artifactOwnerActive(id) })),
      )
      return true
    }
    throw new RequestError(404, 'Not found')
  }
}
