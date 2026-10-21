import { createRemoteJWKSet, jwtVerify } from 'jose'
import { hash, secret, type Login } from './store.js'
export type IdentityProvider = {
  authorizationOrigin: string
  authorize(login: Login): Promise<string>
  exchange(login: Login, code: string): Promise<AccountIdentity>
}
export type AccountIdentity = {
  id: string
  name: string
  organization?: { id: string; name: string; policy: string }
  sessionExpiresAt?: number
}
export function casdoor(options: {
  issuer: string
  clientId: string
  origin: string
  clientSecret?: string
  endpointOrigins?: readonly string[]
  requiredClaim?: { name: string; values: readonly string[] }
  organization?: { id: string; name: string; policy: string; sessionHours: number }
}): IdentityProvider {
  const issuer = options.issuer
  const parsedIssuer = new URL(issuer)
  if (
    parsedIssuer.username ||
    parsedIssuer.password ||
    parsedIssuer.search ||
    parsedIssuer.hash ||
    (parsedIssuer.protocol !== 'https:' &&
      !(parsedIssuer.protocol === 'http:' && parsedIssuer.hostname === '127.0.0.1'))
  )
    throw new Error('Configure a trusted HTTPS OIDC issuer')
  const endpointOrigins = [parsedIssuer.origin, ...(options.endpointOrigins ?? [])]
  let keys: ReturnType<typeof createRemoteJWKSet> | undefined
  let discovery:
    | Promise<{ authorization_endpoint: string; token_endpoint: string; jwks_uri: string }>
    | undefined
  const metadata = () =>
    (discovery ??= fetch(issuer.replace(/\/$/, '') + '/.well-known/openid-configuration', {
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Identity provider is unavailable')
        const value: unknown = await response.json()
        if (
          !value ||
          typeof value !== 'object' ||
          !('issuer' in value) ||
          value.issuer !== issuer ||
          !('authorization_endpoint' in value) ||
          typeof value.authorization_endpoint !== 'string' ||
          !('token_endpoint' in value) ||
          typeof value.token_endpoint !== 'string' ||
          !('jwks_uri' in value) ||
          typeof value.jwks_uri !== 'string'
        )
          throw new Error('Invalid identity provider discovery')
        for (const endpoint of [value.authorization_endpoint, value.token_endpoint, value.jwks_uri])
          if (
            !endpointOrigins.includes(new URL(endpoint).origin) ||
            new URL(endpoint).username ||
            new URL(endpoint).password
          )
            throw new Error('Unexpected identity provider endpoint')
        return {
          authorization_endpoint: value.authorization_endpoint,
          token_endpoint: value.token_endpoint,
          jwks_uri: value.jwks_uri,
        }
      })
      .catch((error) => {
        discovery = undefined
        throw error
      }))
  return {
    authorizationOrigin: parsedIssuer.origin,
    async authorize(login: Login) {
      const meta = await metadata()
      login.state = secret()
      login.nonce = secret()
      login.verifier = secret()
      const url = new URL(meta.authorization_endpoint)
      url.search = new URLSearchParams({
        client_id: options.clientId,
        response_type: 'code',
        redirect_uri: options.origin + '/auth/callback',
        scope: 'openid profile',
        state: login.state,
        nonce: login.nonce,
        code_challenge: hash(login.verifier),
        code_challenge_method: 'S256',
      }).toString()
      return url.href
    },
    async exchange(login: Login, code: string) {
      if (!login.verifier || !login.nonce) throw new Error('Sign-in has not started')
      const meta = await metadata()
      const response = await fetch(meta.token_endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: options.clientId,
          redirect_uri: options.origin + '/auth/callback',
          code,
          code_verifier: login.verifier,
          ...(options.clientSecret ? { client_secret: options.clientSecret } : {}),
        }),
      })
      if (!response.ok) throw new Error('Sign-in could not be completed')
      const tokens: unknown = await response.json()
      if (
        !tokens ||
        typeof tokens !== 'object' ||
        !('id_token' in tokens) ||
        typeof tokens.id_token !== 'string'
      )
        throw new Error('Identity provider did not return an ID token')
      keys ??= createRemoteJWKSet(new URL(meta.jwks_uri), { timeoutDuration: 10_000 })
      const { payload } = await jwtVerify(tokens.id_token, keys, {
        issuer,
        audience: options.clientId,
        algorithms: ['RS256', 'ES256'],
        requiredClaims: ['sub', 'exp', 'iat', 'nonce'],
        maxTokenAge: '10m',
      })
      if (
        payload.nonce !== login.nonce ||
        !payload.sub ||
        (payload.azp !== undefined && payload.azp !== options.clientId)
      )
        throw new Error('Sign-in identity did not match')
      if (options.requiredClaim) {
        const claim = payload[options.requiredClaim.name]
        const values =
          typeof claim === 'string'
            ? [claim]
            : Array.isArray(claim)
              ? claim.filter((value): value is string => typeof value === 'string')
              : []
        if (!options.requiredClaim.values.some((value) => values.includes(value)))
          throw new Error('Organization membership is required')
      }
      return {
        id: options.organization
          ? `oidc:${options.organization.id}:${hash(issuer + '\0' + payload.sub)}`
          : payload.sub,
        name: typeof payload.name === 'string' ? payload.name.slice(0, 200) : payload.sub,
        ...(options.organization
          ? {
              organization: {
                id: options.organization.id,
                name: options.organization.name,
                policy: options.organization.policy,
              },
              sessionExpiresAt: Date.now() + options.organization.sessionHours * 3600_000,
            }
          : {}),
      }
    },
  }
}
