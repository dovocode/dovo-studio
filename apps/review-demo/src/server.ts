import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { DemoError, DemoSessions, sameSecret, secret } from './sessions.js'

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
const style = `:root{color-scheme:dark;font-family:system-ui,sans-serif;color:#e8eaf0;background:#11141b}body{margin:0;padding:48px 20px}main{max-width:760px;margin:auto}h1{font-size:clamp(32px,6vw,52px);letter-spacing:-.04em;line-height:1.1}h2{margin-top:36px}p,li{line-height:1.7;color:#b4bdcf}li{margin:12px 0}a{color:#a1c1ff}form{margin:24px 0}input,button{font:inherit;border-radius:10px;padding:12px 16px;border:1px solid #3b465a;background:#1c2330;color:#fff}input{display:block;margin:12px 0;width:min(90%,360px)}button{cursor:pointer;background:#476bd8;border-color:#6485ed}button:focus-visible,input:focus-visible{outline:3px solid #a1c1ff;outline-offset:3px}code{font-size:1.5em;letter-spacing:.15em}strong{overflow-wrap:anywhere}[role=alert]{color:#ffb1a8}`
const styleHash = createHash('sha256').update(style).digest('base64')
const disclaimer =
  'Simulated review environment. Fictional threads and files only. No real computers, repositories, AI providers or accounts are connected. Commands, agents, terminals, integrations and push delivery are unavailable here.'
async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    length += buffer.length
    if (length > 8192) throw new DemoError(413, 'Request too large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}
function object(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw)
    if (value && typeof value === 'object' && !Array.isArray(value))
      return value as Record<string, unknown>
  } catch {
    /* Reject malformed input below. */
  }
  throw new DemoError(400, 'Expected a JSON object')
}
function field(value: Record<string, unknown>, key: string): string {
  const item = value[key]
  if (typeof item !== 'string' || item.length > 1000) throw new DemoError(400, `Invalid ${key}`)
  return item
}
export function createDemoServer(config: { origin: string; password: string; now?: () => number }) {
  const origin = new URL(config.origin)
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.origin !== config.origin ||
    config.password.length < 24
  )
    throw new Error(
      'Set a valid demo origin and a dedicated reviewer password of at least 24 characters',
    )
  const now = config.now ?? Date.now
  const demo = new DemoSessions(now)
  const sessions = new Map<string, number>()
  const rates = new Map<string, { count: number; until: number }>()
  const limit = (key: string, max: number) => {
    for (const [k, v] of rates) if (v.until <= now()) rates.delete(k)
    const entry = rates.get(key) ?? { count: 0, until: now() + 60_000 }
    if (entry.count >= max || (!rates.has(key) && rates.size >= 2000))
      throw new DemoError(429, 'Too many requests. Please wait a minute.')
    entry.count++
    rates.set(key, entry)
  }
  const cookie = (req: IncomingMessage) =>
    req.headers.cookie
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith('demo_session='))
      ?.slice(13) ?? ''
  const portalSession = (req: IncomingMessage) => {
    for (const [key, expiry] of sessions) if (expiry <= now()) sessions.delete(key)
    return sessions.has(cookie(req))
  }
  const json = (res: ServerResponse, value: unknown) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(value))
  }
  const page = (res: ServerResponse, signedIn: boolean, code?: string, error?: string) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dovo · Review workspace</title><style>${style}</style><body><main><p>DOVO STUDIO / REVIEW</p><h1>A safe workspace to explore.</h1><p>${disclaimer}</p>${error ? `<p role="alert">${escape(error)}</p>` : ''}${signedIn ? `<h2>Connect the app</h2><ol><li>In Dovo Studio, open the computer selector and choose Add computer / Connect.</li><li>Enter <strong>${escape(config.origin)}</strong> as the runtime address.</li><li>Generate a code below, then enter it in the app within two minutes. Pairing is automatically approved by this simulated service.</li><li>Open Fictional demo workspace, then Make greetings feel personal. Read the conversation and inspect Files / Changes.</li></ol>${code ? `<h2>Pairing code: <code>${code}</code></h2><p>Single use · expires in two minutes. Generate another whenever needed.</p><p><a href="dovo://pair?${escape(new URLSearchParams({ address: config.origin, code, expiresAt: new Date(now() + 120_000).toISOString() }).toString())}">Open pairing in Dovo Studio</a> (or enter the address and code manually).</p>` : ''}<form method="post" action="/code"><button>Generate fresh pairing code</button></form><p>Demo connections last 24 hours, or until this service restarts. Re-pair here if needed. Dovo account sign-in is optional and is not needed for this demo.</p><form method="post" action="/logout"><button>Sign out of review page</button></form>` : '<h2>Reviewer access</h2><p>Use the dedicated review-page password supplied in the private store review instructions. This is not a Dovo account password.</p><form method="post" action="/login"><label>Review password <input type="password" name="password" required autocomplete="current-password"></label><button>Open review workspace</button></form>'}<p><a href="https://dovo.studio/privacy/">Privacy</a> · <a href="mailto:info@dovocode.com">Review support</a></p></main></body></html>`,
    )
  }
  return createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    // Same-origin forms need their Origin header; no-referrer makes Chrome send Origin: null.
    res.setHeader('Referrer-Policy', 'same-origin')
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; style-src 'sha256-${styleHash}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
    )
    void (async () => {
      const path = new URL(req.url ?? '/', config.origin).pathname
      if (req.method === 'GET' && path === '/health')
        return json(res, {
          ok: true,
          service: 'dovo-runtime',
          version: 1,
          runtimeId: 'dovo-isolated-review-demo',
        })
      if (req.method === 'GET' && path === '/') return page(res, portalSession(req))
      if (req.method === 'POST' && ['/login', '/code', '/logout'].includes(path)) {
        if (req.headers.origin !== config.origin)
          throw new DemoError(403, 'Open the review page before continuing')
        if (path === '/login') {
          limit('portal-login', 60)
          const password = new URLSearchParams(await body(req)).get('password') ?? ''
          if (!sameSecret(password, config.password))
            throw new DemoError(401, 'Invalid review password')
          portalSession(req)
          if (sessions.size >= 500) throw new DemoError(429, 'The demo is busy')
          const id = secret()
          sessions.set(id, now() + 8 * 60 * 60_000)
          res.setHeader(
            'Set-Cookie',
            `demo_session=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${origin.protocol === 'https:' ? '; Secure' : ''}`,
          )
          res.statusCode = 303
          res.setHeader('Location', '/')
          return res.end()
        }
        if (!portalSession(req)) throw new DemoError(401, 'Open the review page and sign in again')
        if (path === '/logout') {
          sessions.delete(cookie(req))
          res.setHeader('Set-Cookie', 'demo_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0')
          return page(res, false)
        }
        limit(`codes:${cookie(req)}`, 10)
        return page(res, true, demo.code())
      }
      if (req.method === 'POST' && path.startsWith('/api/pair/')) {
        limit('pairing', 120)
        const input = object(await body(req))
        if (path === '/api/pair/request') {
          if (input.protocolVersion !== 2) throw new DemoError(426, 'Update the app before pairing')
          if (
            !/^\d{8}$/.test(field(input, 'code')) ||
            !field(input, 'name').trim() ||
            field(input, 'name').length > 100
          )
            throw new DemoError(400, 'Invalid pairing request')
          return json(res, demo.pair(field(input, 'code')))
        }
        const action = path.slice('/api/pair/'.length)
        if (action === 'claim' || action === 'confirm' || action === 'cancel')
          return json(res, demo.claim(field(input, 'id'), field(input, 'secret'), action))
        throw new DemoError(404, 'Unknown demo route')
      }
      const token = req.headers.authorization?.replace(/^Bearer /, '') ?? ''
      const snapshot = demo.device(token)
      limit(`device:${token}`, 300)
      if (req.method === 'GET' && path === '/api/snapshot') return json(res, snapshot)
      if (req.method === 'POST') {
        // Explicit allowlist. All unimplemented operations fail closed, including agents, terminals and account APIs.
        const allowed = [
          '/api/tasks/history',
          '/api/tasks/files/list',
          '/api/tasks/files/read',
          '/api/tasks/viewed',
          '/api/activity',
          '/api/tasks/checkouts/changes',
        ]
        if (!allowed.includes(path)) throw new DemoError(403, disclaimer)
        const input = object(await body(req))
        if (path === '/api/activity') return json(res, { events: [] })
        const task = snapshot.workspace.tasks.find((t) => t.id === field(input, 'id'))
        if (!task) throw new DemoError(404, 'Fictional thread not found')
        if (path === '/api/tasks/history')
          return json(res, { messages: task.messages, turns: task.turns ?? [] })
        if (path === '/api/tasks/viewed') return json(res, { ok: true })
        if (path === '/api/tasks/files/list')
          return json(res, { files: task.files.map((f) => f.path) })
        if (path === '/api/tasks/checkouts/changes') return json(res, { files: task.files })
        const file = task.files.find((f) => f.path === field(input, 'path'))
        if (!file) throw new DemoError(404, 'Fictional file not found')
        return json(res, { path: file.path, contents: file.after })
      }
      throw new DemoError(404, 'This route is unavailable in the simulated demo')
    })().catch((error: unknown) => {
      res.statusCode = error instanceof DemoError ? error.status : 500
      json(res, {
        error:
          error instanceof DemoError ? error.message : 'The demo could not complete this request',
      })
    })
  })
}
