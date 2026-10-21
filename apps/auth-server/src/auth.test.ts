import { afterEach, expect, it } from 'vite-plus/test'
import { createAuth } from './auth.js'

const close: Array<() => void> = []
afterEach(() => {
  for (const cleanup of close.splice(0)) cleanup()
})
const options = {
  path: ':memory:',
  origin: 'https://auth.example.test',
  secret: 'test-auth-secret-at-least-thirty-two-characters',
  github: { clientId: 'test-github', clientSecret: 'test-github-secret' },
  connectOrigin: 'https://connect.example.test',
  clientId: 'dovo-connect',
  clientSecret: 'test-connect-client-secret-at-least-thirty-two-characters',
}
async function fixture() {
  const identity = await createAuth(options)
  close.push(identity.close)
  return identity
}
it('serves independent OIDC metadata and keeps only a hashed Connect secret', async () => {
  const identity = await fixture()
  const response = await identity.auth.handler(
    new Request(options.origin + '/api/auth/.well-known/openid-configuration'),
  )
  expect(response.status).toBe(200)
  const metadata = await response.json()
  expect(metadata.issuer).toBe(options.origin + '/api/auth')
  expect(metadata.id_token_signing_alg_values_supported).toEqual(['ES256'])
  expect(metadata.grant_types_supported).toEqual(['authorization_code'])
  expect(JSON.stringify(identity.db.prepare('SELECT * FROM oauthClient').all())).not.toContain(
    options.clientSecret,
  )
})
it('uses Secure HttpOnly cookies only on the auth host', async () => {
  const identity = await fixture()
  const response = await identity.auth.api.signInSocial({
    body: { provider: 'github', callbackURL: options.origin + '/' },
    asResponse: true,
  })
  expect(response.status).toBe(200)
  expect(response.headers.getSetCookie().length).toBeGreaterThan(0)
  for (const cookie of response.headers.getSetCookie()) {
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).not.toMatch(/Domain=/i)
  }
})
it('rejects unregistered redirects and public client registration', async () => {
  const identity = await fixture()
  const query = new URLSearchParams({
    client_id: options.clientId,
    response_type: 'code',
    redirect_uri: 'https://attacker.example.test/auth/callback',
    scope: 'openid profile',
    state: 'test-state',
    code_challenge: 'x'.repeat(43),
    code_challenge_method: 'S256',
  })
  const response = await identity.auth.handler(
    new Request(options.origin + '/api/auth/oauth2/authorize?' + query),
  )
  expect(response.headers.get('location') ?? (await response.text())).not.toContain(
    'https://attacker.example.test/auth/callback?code=',
  )
  const registered = await identity.auth.handler(
    new Request(options.origin + '/api/auth/oauth2/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['https://attacker.example.test/callback'] }),
    }),
  )
  expect(registered.status).toBeGreaterThanOrEqual(400)
})
it('rejects incomplete credentials before opening storage', async () => {
  await expect(
    createAuth({ ...options, github: { clientId: '', clientSecret: '' } }),
  ).rejects.toThrow('GitHub')
  await expect(createAuth({ ...options, clientSecret: '' })).rejects.toThrow('secrets')
})
