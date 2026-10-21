import { oidcProvider } from './oidc.js'
import { RequestError } from './http.js'

/** Connect has no identity database, OAuth provider secret or Better Auth cookies. */
export function remoteIdentity(options: {
  issuer: string
  origin: string
  clientId: string
  clientSecret: string
  serviceKey: string
}) {
  if (options.clientSecret.length < 32 || options.serviceKey.length < 32)
    throw new Error('Configure private auth client and service keys')
  const issuer = new URL(options.issuer)
  if (issuer.pathname !== '/api/auth' || issuer.search || issuer.hash)
    throw new Error('Configure the Dovo auth issuer ending in /api/auth')
  return {
    ...oidcProvider({ ...options, accountIdClaim: 'https://dovo.studio/account_id' }),
    async deleteIdentity(this: void, id: string) {
      const response = await fetch(
        new URL('/internal/identities/' + encodeURIComponent(id), issuer),
        {
          method: 'DELETE',
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
          headers: { Authorization: `Bearer ${options.serviceKey}` },
        },
      )
      if (response.status !== 204) throw new RequestError(503, 'Identity deletion is unavailable')
    },
  }
}
