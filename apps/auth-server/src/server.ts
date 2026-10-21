import { createServer } from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node'
import { verifyOAuthQueryParams } from '@better-auth/oauth-provider'
import type { createAuth } from './auth.js'

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
export function createAuthServer(
  identity: Awaited<ReturnType<typeof createAuth>>,
  options: {
    origin: string
    serviceKey: string
  },
) {
  if (options.serviceKey.length < 32)
    throw new Error('Configure a private 32+ character auth service key')
  const origin = new URL(options.origin).origin
  const handler = toNodeHandler(identity.auth)
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Referrer-Policy', 'same-origin')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; form-action 'self' https://github.com ${identity.connectOrigin}; frame-ancestors 'none'; base-uri 'none'`,
    )
    try {
      const url = new URL(req.url ?? '/', origin)
      if (req.method === 'GET' && url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('{"ok":true}')
        return
      }
      if (url.pathname.startsWith('/internal/identities/')) {
        const supplied = req.headers.authorization?.replace(/^Bearer /, '') ?? ''
        const digest = (value: string) => createHash('sha256').update(value).digest()
        if (!timingSafeEqual(digest(supplied), digest(options.serviceKey))) {
          res.writeHead(401)
          res.end()
          return
        }
        if (req.method !== 'DELETE') {
          res.writeHead(405)
          res.end()
          return
        }
        const id = decodeURIComponent(url.pathname.slice('/internal/identities/'.length))
        if (!id || id.length > 200) {
          res.writeHead(400)
          res.end()
          return
        }
        await identity.deleteIdentity(id)
        res.writeHead(204)
        res.end()
        return
      }
      if (url.pathname === '/resume' && req.method === 'GET') {
        const context = await identity.auth.$context
        if (!(await verifyOAuthQueryParams(url.search.slice(1), context.secret))) {
          res.writeHead(400)
          res.end('Sign-in expired')
          return
        }
        res.writeHead(303, { Location: origin + '/api/auth/oauth2/authorize' + url.search })
        res.end()
        return
      }
      if (url.pathname === '/sign-in') {
        const query = url.search.slice(1)
        const context = await identity.auth.$context
        if (!(await verifyOAuthQueryParams(query, context.secret))) {
          res.writeHead(400)
          res.end('Sign-in expired. Start again in Studio.')
          return
        }
        if (req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(
            `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Dovo sign-in</title><h1>Sign in to Dovo</h1><form method="post" action="/sign-in?${escape(query)}"><button>Continue with GitHub</button></form></html>`,
          )
          return
        }
        if (req.method === 'POST') {
          if (req.headers.origin !== origin) {
            res.writeHead(403)
            res.end()
            return
          }
          const response = await identity.auth.handler(
            new Request(origin + '/api/auth/sign-in/social', {
              method: 'POST',
              headers: {
                ...Object.fromEntries(fromNodeHeaders(req.headers)),
                'content-type': 'application/json',
              },
              body: JSON.stringify({
                provider: 'github',
                callbackURL: origin + '/resume?' + query,
                oauth_query: query,
              }),
            }),
          )
          const data: unknown = await response.json()
          if (
            !response.ok ||
            !data ||
            typeof data !== 'object' ||
            !('url' in data) ||
            typeof data.url !== 'string'
          )
            throw new Error('Sign-in unavailable')
          const destination = new URL(data.url)
          if (destination.origin !== 'https://github.com')
            throw new Error('Unexpected sign-in destination')
          res.setHeader('Set-Cookie', response.headers.getSetCookie())
          res.writeHead(303, { Location: destination.href })
          res.end()
          return
        }
        res.writeHead(405)
        res.end()
        return
      }
      if (url.pathname.startsWith('/api/auth/') || url.pathname.startsWith('/.well-known/')) {
        await handler(req, res)
        return
      }
      res.writeHead(404)
      res.end()
    } catch {
      if (!res.headersSent) res.writeHead(503)
      res.end('Authentication is temporarily unavailable')
    }
  })
}
