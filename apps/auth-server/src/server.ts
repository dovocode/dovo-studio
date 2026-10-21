import { createServer } from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node'
import { verifyOAuthQueryParams } from '@better-auth/oauth-provider'
import type { createAuth } from './auth.js'

import { accountPage, page, signInPage, styles, sessionLabel } from './pages.js'

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
        sendPage(
          'Sign-in interrupted',
          '<div class="layout"><section><div class="eyebrow">Dovo Auth</div><h1>Let’s try that again.</h1><p>Sign-in was cancelled, expired or could not be completed. Your existing computers and pairings are unchanged.</p></section><section class="card"><h2>Continue safely</h2><p>If you started in Dovo Studio or Artifacts, return there and start sign-in again. To manage your identity here, continue below.</p><a class="button" href="/sign-in">Back to sign-in</a></section></div>',
        )
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
          sendPage(
            'Sign-in expired',
            '<h1>This sign-in has expired.</h1><p>Start again from Dovo Studio.</p><a href="/sign-in">Sign in</a>',
            false,
            400,
          )
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
          else
            sendPage(
              'Sign in again',
              '<h1>Your session has ended.</h1><p>Sign in again to manage your account.</p><a class="button" href="/sign-in">Sign in</a>',
              false,
              401,
            )
          return
        }
        if (req.method === 'POST') {
          if (req.headers.origin !== origin) {
            sendPage(
              'Request blocked',
              '<h1>Request blocked.</h1><p>Return to your account and try again.</p><a href="/account">Your account</a>',
              true,
              403,
            )
            return
          }
          let body = ''
          for await (const chunk of req) {
            body += String(chunk)
            if (Buffer.byteLength(body) > 4096) {
              sendPage('Request too large', '<h1>Request too large.</h1>', true, 413)
              return
            }
          }
          const form = new URLSearchParams(body)
          if (url.pathname === '/account/profile') {
            const name = form.get('name')?.trim() ?? ''
            if (!name || name.length > 100) {
              sendPage(
                'Check your name',
                '<h1>Enter a name between 1 and 100 characters.</h1><a href="/account">Back to your account</a>',
                true,
                400,
              )
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
              sendPage(
                'Session unavailable',
                '<h1>This session is no longer active.</h1><a href="/account">Back to your account</a>',
                true,
                404,
              )
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
          sendPage(
            'Not found',
            '<h1>Page not found.</h1><a href="/account">Your account</a>',
            true,
            404,
          )
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
          res.end(
            page(
              'Sign-in expired',
              '<h1>This sign-in has expired.</h1><p>Start again from Dovo Studio, or sign in to manage your account.</p><a class="button" href="/sign-in">Sign in</a>',
            ),
          )
          return
        }
        if (req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(signInPage(query))
          return
        }
        if (req.method === 'POST') {
          if (req.headers.origin !== origin) {
            sendPage(
              'Request blocked',
              '<h1>Request blocked.</h1><p>Start sign-in from Dovo Auth or Dovo Studio.</p><a href="/sign-in">Sign in</a>',
              false,
              403,
            )
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
      sendPage(
        'Not found',
        '<h1>Page not found.</h1><p>Return to Dovo Auth to continue.</p><a class="button" href="/">Dovo Auth</a>',
        false,
        404,
      )
    } catch {
      if (!res.headersSent) {
        res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(
          page(
            'Try again',
            '<h1>We couldn’t complete that request.</h1><p>Try again, or restart sign-in from Dovo Studio if your request expired.</p><a class="button" href="/">Back to Dovo Auth</a>',
          ),
        )
      } else res.end()
    }
  })
}
