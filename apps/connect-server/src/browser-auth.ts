import type { IncomingMessage, ServerResponse } from 'node:http'
import { AccountStore, hash, secret } from './store.js'
import type { IdentityProvider } from './oidc.js'
import { html, RequestError } from './http.js'

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  )

export function browserAuth(options: { store: AccountStore; origin: string } & IdentityProvider) {
  const { store, origin } = options
  const cookieName = origin.startsWith('https:') ? '__Host-dovo-login' : 'dovo-login'
  const cookieFlags = `HttpOnly; SameSite=Lax; Path=/${origin.startsWith('https:') ? '; Secure' : ''}`
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    if (req.method === 'GET' && url.pathname === '/auth/start') {
      const login = store.login(url.searchParams.get('id') ?? '')
      if (!login) throw new RequestError(410, 'Sign-in expired. Start again in Studio.')
      const browser = secret()
      login.browserHash = hash(browser)
      store.saveLogin(login)
      res.setHeader(
        'Set-Cookie',
        `${cookieName}=${login.id}.${browser}; Max-Age=300; ${cookieFlags}`,
      )
      html(
        res,
        200,
        `<h2>Sign in to discover your computers</h2><p>Only continue if you started sign-in in Dovo Studio and see this code there:</p><h2>${escape(login.code)}</h2><p>Pairing approval is still required to access a computer.</p><form method="post" action="/auth/authorize"><button type="submit">Continue to sign in</button></form>`,
      )
      return true
    }
    const browserLogin = () => {
      const cookie = (req.headers.cookie ?? '')
        .split('; ')
        .find((c) => c.startsWith(cookieName + '='))
        ?.slice(cookieName.length + 1)
      const [id, browser] = cookie?.split('.') ?? []
      const login = id ? store.login(id) : undefined
      if (!browser || !login || login.browserHash !== hash(browser))
        throw new RequestError(
          400,
          'Sign-in expired or browser session changed. Start again in Studio.',
        )
      return login
    }
    if (req.method === 'POST' && url.pathname === '/auth/authorize') {
      if (req.headers.origin !== origin)
        throw new RequestError(403, 'Sign-in must start from this page')
      const login = browserLogin()
      const location = await options.authorize(login)
      store.saveLogin(login)
      res.writeHead(303, { Location: location })
      res.end()
      return true
    }
    if (req.method === 'GET' && url.pathname === '/auth/callback') {
      const login = browserLogin()
      if (!login.state || url.searchParams.get('state') !== login.state)
        throw new RequestError(400, 'Sign-in request did not match')
      if (url.searchParams.has('error'))
        throw new RequestError(400, 'Sign-in was cancelled. Return to Studio and try again.')
      const code = url.searchParams.get('code')
      if (!code || code.length > 4096) throw new RequestError(400, 'Missing sign-in code')
      // Consume browser state before the network exchange to reject concurrent callback replay.
      const state = login.state
      login.state = undefined
      store.saveLogin(login)
      const user = await options.exchange({ ...login, state }, code)
      store.approve(login, user)
      res.setHeader('Set-Cookie', `${cookieName}=; Max-Age=0; ${cookieFlags}`)
      html(
        res,
        200,
        '<h2>You are signed in</h2><p>Return to Dovo Studio. Your computers will appear there.</p>',
      )
      return true
    }
    return false
  }
}
