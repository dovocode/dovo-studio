import { expect, it } from 'vite-plus/test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { casdoor } from './oidc.js'
import { hash, type Login } from './store.js'
it.each(['', '/realms/company'])(
  'uses S256 PKCE and validates signed identity, audience, nonce and expiry with issuer path %s',
  async (issuerPath) => {
    const { privateKey, publicKey } = await generateKeyPair('RS256')
    let origin = '',
      nonce = '',
      challenge = '',
      mode = 'valid'
    const received: URLSearchParams[] = []
    const provider = createServer((request, response) => {
      void (async () => {
        response.setHeader('Content-Type', 'application/json')
        if (request.url === issuerPath + '/.well-known/openid-configuration')
          return response.end(
            JSON.stringify({
              issuer: origin,
              authorization_endpoint: origin + '/authorize',
              token_endpoint: origin + '/token',
              jwks_uri: origin + '/keys',
            }),
          )
        if (request.url === issuerPath + '/keys')
          return response.end(
            JSON.stringify({
              keys: [{ ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256', use: 'sig' }],
            }),
          )
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        const body = new URLSearchParams(Buffer.concat(chunks).toString())
        received.push(body)
        const token = await new SignJWT({
          nonce: mode === 'nonce' ? 'wrong' : nonce,
          name: 'Dominic',
          groups: mode === 'group' ? ['other'] : ['relay-users'],
        })
          .setProtectedHeader({ alg: 'RS256', kid: 'test' })
          .setIssuer(origin)
          .setAudience(mode === 'audience' ? 'other' : 'public-client')
          .setSubject('person')
          .setIssuedAt()
          .setExpirationTime(mode === 'expired' ? Math.floor(Date.now() / 1000) - 100 : '5m')
          .sign(privateKey)
        response.end(JSON.stringify({ id_token: token }))
      })().catch(() => {
        response.statusCode = 500
        response.end('{}')
      })
    })
    provider.listen(0, '127.0.0.1')
    await once(provider, 'listening')
    const address = provider.address()
    if (!address || typeof address === 'string') throw new Error('Missing port')
    origin = 'http://127.0.0.1:' + address.port + issuerPath
    try {
      const oidc = casdoor({
        issuer: origin,
        clientId: 'public-client',
        origin: 'https://connect.test',
      })
      const login: Login = {
        id: 'id',
        tokenHash: 'hash',
        code: '12345678',
        expires: Date.now() + 300000,
      }
      const authorize = new URL(await oidc.authorize(login))
      nonce = authorize.searchParams.get('nonce')!
      challenge = authorize.searchParams.get('code_challenge')!
      expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
      expect(authorize.searchParams.get('redirect_uri')).toBe('https://connect.test/auth/callback')
      expect(await oidc.exchange(login, 'code')).toEqual({ id: 'person', name: 'Dominic' })
      mode = 'nonce'
      await expect(oidc.exchange(login, 'code')).rejects.toThrow('Sign-in identity did not match')
      mode = 'audience'
      await expect(oidc.exchange(login, 'code')).rejects.toThrow('aud')
      mode = 'expired'
      await expect(oidc.exchange(login, 'code')).rejects.toThrow('exp')
      expect(received).toHaveLength(4)
      expect(received.map((body) => hash(body.get('code_verifier')!))).toEqual(
        Array(4).fill(challenge),
      )
      expect(received.some((body) => body.has('client_secret'))).toBe(false)
      mode = 'valid'
      const company = casdoor({
        issuer: origin,
        clientId: 'public-client',
        origin: 'https://connect.test',
        requiredClaim: { name: 'groups', values: ['relay-users'] },
        organization: { id: 'company', name: 'Company', policy: 'policy-v1', sessionHours: 1 },
      })
      const organizationIdentity = await company.exchange(login, 'code')
      expect(organizationIdentity.id).toBe('oidc:company:' + hash(origin + '\0person'))
      expect(organizationIdentity.organization).toEqual({
        id: 'company',
        name: 'Company',
        policy: 'policy-v1',
      })
      expect(organizationIdentity.sessionExpiresAt).toBeLessThanOrEqual(Date.now() + 3600_000)
      mode = 'group'
      await expect(company.exchange(login, 'code')).rejects.toThrow(
        'Organization membership is required',
      )
    } finally {
      await new Promise<void>((resolve) => {
        provider.close(() => resolve())
        provider.closeAllConnections()
      })
    }
  },
)
