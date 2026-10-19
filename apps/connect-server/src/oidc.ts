import { createRemoteJWKSet, jwtVerify } from 'jose'
import { hash, secret, type Login } from './store.js'
export type IdentityProvider = {
  authorizationOrigin: string
  authorize(login: Login): Promise<string>
  exchange(login: Login, code: string): Promise<{ id: string; name: string }>
}
export function casdoor(options: {
  issuer: string
  clientId: string
  origin: string
}): IdentityProvider {
  const issuer = new URL(options.issuer).origin
  let keys: ReturnType<typeof createRemoteJWKSet> | undefined
  let discovery:
    | Promise<{ authorization_endpoint: string; token_endpoint: string; jwks_uri: string }>
    | undefined
  const metadata = () =>
    (discovery ??= fetch(new URL('/.well-known/openid-configuration', issuer), {
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
          if (new URL(endpoint).origin !== issuer)
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
    authorizationOrigin: issuer,
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
        algorithms: ['RS256'],
        requiredClaims: ['sub', 'exp', 'iat', 'nonce'],
        maxTokenAge: '10m',
      })
      if (
        payload.nonce !== login.nonce ||
        !payload.sub ||
        (payload.azp !== undefined && payload.azp !== options.clientId)
      )
        throw new Error('Sign-in identity did not match')
      return {
        id: payload.sub,
        name: typeof payload.name === 'string' ? payload.name.slice(0, 200) : payload.sub,
      }
    },
  }
}
