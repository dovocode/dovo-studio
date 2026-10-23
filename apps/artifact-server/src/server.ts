import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { Schema } from 'effect'
import {
  artifactServiceOrigin,
  artifactSessionSchema,
  accountLoginSchema,
  decode,
  mutableArray,
  mutableStruct,
  artifactPublicationInputSchema,
  artifactInviteSchema,
  artifactLinkInputSchema,
  HOSTED_ARTIFACT_MAX_BYTES,
  artifactPrintDocument,
  artifactSourceMarkdown,
  ValidationError,
  artifactFeedSessionSchema,
  artifactFeedQuerySchema,
  artifactFeedGuestScript,
  ARTIFACT_FEED_MAX_BYTES,
  uuidSchema,
} from '@dovo/protocol'
import { marked } from 'marked'
import { ArtifactStore, ShareError } from './store.js'
import { artifactPage } from './pages.js'

const ownersSchema = mutableArray(mutableStruct({ id: Schema.String, active: Schema.Boolean }))
const okSchema = mutableStruct({ ready: Schema.Boolean })
const tokenPattern = /^[A-Za-z0-9_-]{43}$/
async function body(req: IncomingMessage, max = 16_384): Promise<unknown> {
  if (!req.headers['content-type']?.startsWith('application/json'))
    throw new ShareError(415, 'Use JSON requests')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > max)
      throw new ShareError(
        413,
        max === HOSTED_ARTIFACT_MAX_BYTES
          ? 'Hosted artifacts are limited to 20 MB, including source files'
          : 'Request is too large',
      )
    chunks.push(Buffer.from(chunk))
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString()) as unknown
  } catch {
    throw new ShareError(400, 'Invalid JSON')
  }
}
const json = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(value))
}
export function createArtifactServer(options: {
  store: ArtifactStore
  origin: string
  connectOrigin: string
  serviceKey: string
  viewerScript?: string
}) {
  const { store } = options
  const origin = artifactServiceOrigin(options.origin),
    connectOrigin = artifactServiceOrigin(options.connectOrigin)
  if (origin === connectOrigin) throw new Error('Host artifacts on a separate origin from Connect')
  if (!tokenPattern.test(options.serviceKey))
    throw new Error('Configure a 32-byte base64url artifact service key')
  const script =
    options.viewerScript ?? readFileSync(new URL('./viewer.js', import.meta.url), 'utf8')
  const cookieName = origin.startsWith('https:') ? '__Host-dovo-artifacts' : 'dovo-artifacts'
  const cookie = (res: ServerResponse, token: string, seconds = 28800) =>
    res.setHeader(
      'Set-Cookie',
      `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${origin.startsWith('https:') ? '; Secure' : ''}`,
    )
  const credential = (req: IncomingMessage) => {
    const bearer = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1]
    if (bearer) return bearer
    const token =
      (req.headers.cookie ?? '')
        .split('; ')
        .find((c) => c.startsWith(cookieName + '='))
        ?.slice(cookieName.length + 1) ?? ''
    return tokenPattern.test(token) ? token : ''
  }
  const broker = async (path: string, token: string, method = 'GET', data?: unknown) => {
    let response: Response
    try {
      response = await fetch(connectOrigin + path, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: {
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
          ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: data !== undefined ? JSON.stringify(data) : undefined,
      })
    } catch {
      throw new ShareError(503, 'Account service unavailable. Try again later')
    }
    if (response.status === 401) throw new ShareError(401, 'Sign in to Dovo Artifacts')
    if (!response.ok) throw new ShareError(503, 'Account service unavailable. Try again later')
    return (await response.json()) as unknown
  }
  const identity = async (req: IncomingMessage, required = true) => {
    const token = credential(req)
    if (!token) {
      if (required) throw new ShareError(401, 'Sign in to Dovo Artifacts')
      return
    }
    try {
      const session = decode(artifactSessionSchema, await broker('/v1/artifacts/session', token))
      if (session.audience !== origin || session.expiresAt <= store.now())
        throw new ShareError(401, 'Artifact session is for another service or has expired')
      return session
    } catch (error) {
      if (!required && error instanceof ShareError && error.status === 401) return
      throw error
    }
  }
  const checkOwners = async (ids: string[]) => {
    const owners = decode(
      ownersSchema,
      await broker('/v1/artifacts/owners', options.serviceKey, 'POST', ids),
    )
    if (
      owners.length !== ids.length ||
      new Set(owners.map((owner) => owner.id)).size !== ids.length ||
      owners.some((owner) => !ids.includes(owner.id))
    )
      throw new ShareError(503, 'Invalid account status response')
    return owners
  }
  const pruneOwners = async () => {
    const ids = store.owners()
    for (let n = 0; n < ids.length; n += 100)
      for (const owner of await checkOwners(ids.slice(n, n + 100)))
        if (!owner.active) store.removeOwner(owner.id)
    store.prune()
  }
  const windows = new Map<string, { count: number; until: number }>()
  const limit = (key: string, max: number) => {
    const now = store.now()
    for (const [id, value] of windows) if (value.until <= now) windows.delete(id)
    const window = windows.get(key) ?? { count: 0, until: now + 60_000 }
    if (windows.size >= 10000 || ++window.count > max)
      throw new ShareError(429, 'Too many requests. Try again later')
    windows.set(key, window)
  }
  let active = 0
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
    // srcdoc inherits this policy. Inline scripts must be permitted for interactive guests;
    // their own stricter policy removes same-origin scripts/network, and the opaque sandbox
    // prevents host access. Keep all publisher content out of the trusted shell's DOM sinks.
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data: blob:; font-src data:; media-src data: blob:; frame-src about:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; worker-src 'none'",
    )
    const url = new URL(req.url ?? '/', origin),
      path = url.pathname
    if (path.startsWith('/v1/')) {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    }
    if (req.method === 'OPTIONS') return json(res, 204, {})
    if (req.method === 'GET' && path === '/health')
      return json(res, 200, { ok: true, service: 'dovo-artifacts' })
    limit('ip:' + (req.socket.remoteAddress ?? ''), 1200)
    if (req.method === 'GET' && path === '/viewer.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' })
      return res.end(script)
    }
    if (req.method === 'GET' && (path === '/' || /^\/(?:s|manage)\/[a-f0-9-]{36}$/.test(path))) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end(artifactPage)
    }
    // Cookie authentication is same-origin only. Native clients use explicit bearer grants.
    if (
      req.method !== 'GET' &&
      (path.startsWith('/auth/') ||
        !/^Bearer [A-Za-z0-9_-]{43}$/.test(req.headers.authorization ?? '')) &&
      req.headers.origin !== origin
    )
      throw new ShareError(403, 'Start this action from Dovo Artifacts')
    if (req.method === 'POST' && path === '/auth/start') {
      limit('login:' + (req.socket.remoteAddress ?? ''), 10)
      const login = decode(accountLoginSchema, await broker('/v1/artifacts/login', '', 'POST'))
      if (
        !tokenPattern.test(login.token) ||
        new URL(login.url).origin !== connectOrigin ||
        !login.url.startsWith(connectOrigin + '/auth/start?')
      )
        throw new ShareError(502, 'Invalid sign-in response')
      cookie(res, login.token)
      return json(res, 200, { code: login.code, url: login.url, expiresAt: login.expiresAt })
    }
    if (req.method === 'GET' && path === '/auth/status')
      return json(res, 200, decode(okSchema, await broker('/v1/artifacts/login', credential(req))))
    if (req.method === 'POST' && path === '/auth/session') {
      // Exchange an app's sharing-only grant for an HttpOnly browser cookie. Never accept an account token.
      const input = decode(mutableStruct({ token: Schema.String }), await body(req))
      if (!tokenPattern.test(input.token)) throw new ShareError(400, 'Invalid session')
      const session = decode(
        artifactSessionSchema,
        await broker('/v1/artifacts/session', input.token),
      )
      if (session.audience !== origin)
        throw new ShareError(401, 'Session belongs to another service')
      cookie(res, input.token, Math.max(0, Math.floor((session.expiresAt - store.now()) / 1000)))
      return json(res, 200, { ok: true })
    }
    if (req.method === 'POST' && path === '/auth/logout') {
      await broker('/v1/session', credential(req), 'DELETE')
      cookie(res, '', 0)
      return json(res, 200, { ok: true })
    }
    if (req.method === 'GET' && path === '/v1/me') {
      const session = await identity(req)
      return json(res, 200, session)
    }
    if (path === '/v1/publications/sources' && req.method === 'GET') {
      const session = await identity(req)
      if (!session) throw new ShareError(401, 'Sign in')
      return json(res, 200, { publications: store.sources(session.user.id) })
    }
    if (path === '/v1/publications') {
      if (req.method === 'GET') {
        const session = await identity(req)
        if (!session) throw new ShareError(401, 'Sign in')
        return json(res, 200, { publications: store.list(session.user.id) })
      }
      if (req.method === 'POST') {
        // Authenticate before reading a large body and recheck after it has arrived.
        const session = await identity(req)
        if (!session) throw new ShareError(401, 'Sign in')
        limit('publish:' + session.user.id, 10)
        const input = decode(
          artifactPublicationInputSchema,
          await body(req, HOSTED_ARTIFACT_MAX_BYTES),
        )
        const current = await identity(req)
        if (current?.user.id !== session.user.id) throw new ShareError(401, 'Publication cancelled')
        return json(res, 200, { publication: store.publish(session.user.id, input) })
      }
    }
    const match =
      /^\/v1\/publications\/([a-f0-9-]{36})(?:\/(access|invites|links|feed)(?:\/([a-f0-9-]{36}|lease|data))?)?$/.exec(
        path,
      )
    if (!match) throw new ShareError(404, 'Not found')
    const [, id, action, linkId] = match
    const saved = store.metadata(id)
    const owners = await checkOwners([saved.owner])
    if (!owners.some((owner) => owner.id === saved.owner && owner.active)) {
      store.removeOwner(saved.owner)
      throw new ShareError(404, 'Artifact unavailable or access not granted')
    }
    if (
      action === 'feed' &&
      ((req.method === 'GET' && linkId === 'lease') || (req.method === 'PUT' && linkId === 'data'))
    ) {
      const session = decode(
        artifactFeedSessionSchema,
        await broker('/v1/artifacts/feed-session', credential(req)),
      )
      if (
        session.audience !== origin ||
        session.publicationId !== id ||
        session.expiresAt <= store.now()
      )
        throw new ShareError(401, 'Invalid data feed permission')
      const lease = store.feedLease(id, session.user.id, credential(req))
      if (req.method === 'GET') return json(res, 200, lease)
      const input = decode(
        mutableStruct({ generation: uuidSchema, data: Schema.Unknown }),
        await body(req, ARTIFACT_FEED_MAX_BYTES * 6 + 4096),
      )
      const current = decode(
        artifactFeedSessionSchema,
        await broker('/v1/artifacts/feed-session', credential(req)),
      )
      if (
        current.audience !== origin ||
        current.publicationId !== id ||
        current.user.id !== session.user.id ||
        current.expiresAt <= store.now()
      )
        throw new ShareError(401, 'Data feed permission expired')
      store.feedUpdate(id, session.user.id, credential(req), input.generation, input.data)
      return json(res, 200, { ok: true })
    }
    if (req.method === 'GET' && (!action || (action === 'feed' && !linkId))) {
      const session = await identity(req, false)
      const link = req.headers.authorization?.match(/^DovoShare ([A-Za-z0-9_-]{43})$/)?.[1]
      if (!store.canView(id, session?.user.id, link))
        throw new ShareError(404, 'Artifact unavailable or access not granted')
      if (action === 'feed') return json(res, 200, store.feedData(id))
      const artifact = store.get(id).artifact
      const content =
        artifact.format === 'html' || artifact.format === 'svg'
          ? artifact.content
          : marked.parse(
              artifact.format === 'code' ? artifactSourceMarkdown(artifact) : artifact.content,
              { async: false, gfm: true },
            )
      return json(res, 200, {
        publication: saved.publication,
        content: artifactPrintDocument(artifactFeedGuestScript + content).html,
        owner: session?.user.id === saved.owner,
      })
    }
    const session = await identity(req)
    if (!session) throw new ShareError(401, 'Sign in')
    const user = session.user.id
    limit('account:' + user, 120)
    store.own(id, user)
    if (action === 'feed' && !linkId) {
      if (req.method === 'DELETE') {
        const { generation } = decode(mutableStruct({ generation: uuidSchema }), await body(req))
        store.feedStop(id, user, generation)
        return json(res, 200, { ok: true })
      }
      if (req.method === 'POST') {
        const input = decode(
          mutableStruct({
            writer: Schema.String,
            seconds: artifactFeedQuerySchema.fields.seconds,
            data: Schema.Unknown,
          }),
          await body(req, ARTIFACT_FEED_MAX_BYTES * 6 + 4096),
        )
        if (!tokenPattern.test(input.writer))
          throw new ShareError(400, 'Invalid data feed permission')
        const writer = decode(
          artifactFeedSessionSchema,
          await broker('/v1/artifacts/feed-session', input.writer),
        )
        const current = await identity(req)
        if (current?.user.id !== user) throw new ShareError(401, 'Feed setup cancelled')
        if (
          writer.audience !== origin ||
          writer.publicationId !== id ||
          writer.user.id !== user ||
          writer.expiresAt <= store.now()
        )
          throw new ShareError(403, 'Data feed belongs to another account or artifact')
        return json(
          res,
          200,
          store.feedSetup(id, user, input.writer, writer.expiresAt, input.seconds, input.data),
        )
      }
    }
    if (req.method === 'DELETE' && !action) {
      store.remove(id, user)
      return json(res, 200, { ok: true })
    }
    if (req.method === 'GET' && action === 'access') return json(res, 200, store.access(id, user))
    if (action === 'invites' && !linkId && ['POST', 'DELETE'].includes(req.method ?? '')) {
      const input = decode(artifactInviteSchema, await body(req))
      if (req.method === 'POST') store.invite(id, user, input.userId)
      else store.uninvite(id, user, input.userId)
      return json(res, 200, { ok: true })
    }
    if (action === 'links' && req.method === 'POST' && !linkId) {
      const input = decode(artifactLinkInputSchema, await body(req)),
        link = store.link(id, user, input.seconds)
      return json(res, 200, { ...link, url: origin + '/s/' + id + '#share=' + link.token })
    }
    if (action === 'links' && req.method === 'DELETE' && linkId) {
      store.unlink(id, user, linkId)
      return json(res, 200, { ok: true })
    }
    throw new ShareError(404, 'Not found')
  }
  const server = createServer((req, res) => {
    if (active >= 8) return json(res, 503, { error: 'Artifact service is busy' })
    active++
    void handle(req, res)
      .catch((error) => {
        if (res.headersSent) {
          res.destroy()
          return
        }
        json(
          res,
          error instanceof ShareError ? error.status : error instanceof ValidationError ? 400 : 500,
          {
            error:
              error instanceof ShareError
                ? error.message
                : error instanceof ValidationError
                  ? 'Invalid artifact request'
                  : 'Artifact service could not complete this request',
          },
        )
      })
      .finally(() => active--)
  })
  server.requestTimeout = 30_000
  server.headersTimeout = 10_000
  server.maxHeadersCount = 40
  return { server, pruneOwners }
}
