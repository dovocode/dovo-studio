import type { IncomingMessage, ServerResponse } from 'node:http'
import { AccountStore, hash, secret } from './store.js'
import type { IdentityProvider } from './oidc.js'
import { html, RequestError } from './http.js'
import { connectConsent, connectSuccess } from './pages.js'
import type { Organization } from './organizations.js'

export function browserAuth(
  options: {
    store: AccountStore
    origin: string
    organizations?: readonly Organization[]
  } & IdentityProvider,
) {
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
      html(res, 200, connectConsent(login, options.organizations ?? []))
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
      const id = url.searchParams.get('organization')
      const organization = options.organizations?.find((item) => item.id === id)
      if (id && !organization) throw new RequestError(400, 'Unknown organization')
      login.organization = organization?.id
      const location = await (organization?.provider ?? options).authorize(login)
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
      const organization = options.organizations?.find((item) => item.id === login.organization)
      if (login.organization && !organization)
        throw new RequestError(403, 'Organization sign-in is unavailable')
      const user = await (organization?.provider ?? options).exchange(
        { ...login, state },
        code,
        req.headers,
      )
      store.approve(login, user)
      res.setHeader('Set-Cookie', `${cookieName}=; Max-Age=0; ${cookieFlags}`)
      html(res, 200, connectSuccess(Boolean(login.artifactsOrigin)))
      return true
    }
    return false
  }
}
