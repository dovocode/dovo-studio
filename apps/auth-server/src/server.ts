import { createServer } from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node'
import { verifyOAuthQueryParams } from '@better-auth/oauth-provider'
import type { createAuth } from './auth.js'

import { accountPage, page, signInPage, styles, sessionLabel, authStatusViews } from './pages.js'

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
      `default-src 'none'; style-src 'self'; form-action 'self' https://github.com ${identity.connectOrigin}; frame-ancestors 'none'; base-uri 'none'`,
    )
    try {
      const url = new URL(req.url ?? '/', origin)
      const sendPage = (title: string, body: string, signedIn = false, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(page(title, body, signedIn))
      }
      const redirect = (location: string) => {
        res.writeHead(303, { Location: location })
        res.end()
      }
      if (req.method === 'GET' && url.pathname === '/styles.css') {
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' })
        res.end(styles)
        return
      }
      if (req.method === 'GET' && url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('{"ok":true}')
        return
      }
      if (req.method === 'GET' && url.pathname === '/error') {
        sendPage('Sign-in interrupted', authStatusViews.interrupted)
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
          sendPage('Sign-in expired', authStatusViews.expired, false, 400)
          return
        }
        res.writeHead(303, { Location: origin + '/api/auth/oauth2/authorize' + url.search })
        res.end()
        return
      }
      if (
        url.pathname === '/' ||
        url.pathname === '/account' ||
        url.pathname.startsWith('/account/')
      ) {
        const headers = fromNodeHeaders(req.headers)
        const session = await identity.auth.api.getSession({ headers })
        if (!session) {
          if (req.method === 'GET') redirect('/sign-in')
          else sendPage('Sign in again', authStatusViews.sessionEnded, false, 401)
          return
        }
        if (req.method === 'POST') {
          if (req.headers.origin !== origin) {
            sendPage('Request blocked', authStatusViews.blocked, true, 403)
            return
          }
          let body = ''
          for await (const chunk of req) {
            body += String(chunk)
            if (Buffer.byteLength(body) > 4096) {
              sendPage('Request too large', authStatusViews.tooLarge, true, 413)
              return
            }
          }
          const form = new URLSearchParams(body)
          if (url.pathname === '/account/profile') {
            const name = form.get('name')?.trim() ?? ''
            if (!name || name.length > 100) {
              sendPage('Check your name', authStatusViews.invalidName, true, 400)
              return
            }
            await identity.auth.api.updateUser({ headers, body: { name } })
            redirect('/account?notice=profile')
            return
          }
          if (url.pathname === '/account/revoke-session') {
            const sessions = await identity.auth.api.listSessions({ headers })
            const target = sessions.find((item) => item.id === form.get('id'))
            if (!target) {
              sendPage('Session unavailable', authStatusViews.sessionInactive, true, 404)
              return
            }
            await identity.auth.api.revokeSession({ headers, body: { token: target.token } })
            redirect('/account?notice=session')
            return
          }
          if (url.pathname === '/account/revoke-others') {
            await identity.auth.api.revokeOtherSessions({ headers })
            redirect('/account?notice=sessions')
            return
          }
          if (url.pathname === '/account/sign-out') {
            const response = await identity.auth.api.signOut({ headers, asResponse: true })
            res.setHeader('Set-Cookie', response.headers.getSetCookie())
            redirect('/sign-in')
            return
          }
        }
        if (req.method !== 'GET' || (url.pathname !== '/' && url.pathname !== '/account')) {
          sendPage('Not found', authStatusViews.notFound, true, 404)
          return
        }
        const sessions = await identity.auth.api.listSessions({ headers })
        const notice = {
          profile: 'Your profile has been updated.',
          session: 'Session signed out.',
          sessions: 'Other Auth sessions signed out.',
        }[url.searchParams.get('notice') ?? '']
        const date = (value: Date) =>
          value.toLocaleString('en-GB', {
            timeZone: 'UTC',
            dateStyle: 'medium',
            timeStyle: 'short',
          }) + ' UTC'
        sendPage(
          'Your account',
          accountPage({
            name: session.user.name,
            email: session.user.email,
            notice,
            sessions: sessions.map((item) => ({
              id: item.id,
              label: sessionLabel(item.userAgent),
              lastActive: date(item.updatedAt),
              expiresAt: date(item.expiresAt),
              current: item.id === session.session.id,
            })),
          }),
          true,
        )
        return
      }
      if (url.pathname === '/sign-in') {
        const query = url.search.slice(1)
        const context = await identity.auth.$context
        if (query && !(await verifyOAuthQueryParams(query, context.secret))) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(page('Sign-in expired', authStatusViews.signInExpired))
          return
        }
        if (req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(signInPage(query))
          return
        }
        if (req.method === 'POST') {
          if (req.headers.origin !== origin) {
            sendPage('Request blocked', authStatusViews.signInBlocked, false, 403)
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
                callbackURL: query ? origin + '/resume?' + query : origin + '/account',
                ...(query ? { oauth_query: query } : {}),
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
      sendPage('Not found', authStatusViews.publicNotFound, false, 404)
    } catch {
      if (!res.headersSent) {
        res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(page('Try again', authStatusViews.unavailable))
      } else res.end()
    }
  })
}
