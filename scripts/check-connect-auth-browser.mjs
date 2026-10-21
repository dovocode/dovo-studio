import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { chromium } from './browser/harness.mjs'
import { AccountStore } from '../apps/connect-server/dist/store.js'
import { createConnectServer } from '../apps/connect-server/dist/server.js'
import { createAuth } from '../apps/auth-server/dist/auth.js'
import { createAuthServer } from '../apps/auth-server/dist/server.js'
import { remoteIdentity } from '../apps/connect-server/dist/remote-identity.js'

const store = new AccountStore(':memory:')
let app, identity, browser, origin, authApp, authOrigin
const authIngress = createServer((req, res) => {
  const url = new URL(req.url, authOrigin)
  if (url.pathname === '/test-github') {
    assert.equal(url.searchParams.get('client_id'), 'browser-github-client')
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
    res.writeHead(302, {
      Location: `${authOrigin}/api/auth/callback/github?state=${url.searchParams.get('state')}&code=browser-code`,
    })
    res.end()
    return
  }
  const writeHead = res.writeHead.bind(res)
  res.writeHead = (status, headers) => {
    if (
      !Array.isArray(headers) &&
      headers?.Location?.startsWith('https://github.com/login/oauth/authorize?')
    ) {
      const github = new URL(headers.Location)
      headers = { ...headers, Location: authOrigin + '/test-github' + github.search }
    }
    return writeHead(status, headers)
  }
  authApp.emit('request', req, res)
})
const ingress = createServer((req, res) => app.emit('request', req, res))
const realFetch = globalThis.fetch
try {
  ingress.listen(0, '127.0.0.1')
  await once(ingress, 'listening')
  origin = `http://127.0.0.1:${ingress.address().port}`
  authIngress.listen(0, '127.0.0.1')
  await once(authIngress, 'listening')
  authOrigin = `http://127.0.0.1:${authIngress.address().port}`
  const clientSecret = 'browser-connect-client-secret-at-least-thirty-two-characters'
  const serviceKey = 'browser-auth-service-key-at-least-thirty-two-characters'
  identity = await createAuth({
    path: ':memory:',
    origin: authOrigin,
    secret: 'browser-only-auth-secret-with-at-least-thirty-two-characters',
    github: { clientId: 'browser-github-client', clientSecret: 'browser-github-secret' },
    owners: { 123: 'browser-user' },
    connectOrigin: origin,
    clientId: 'dovo-connect',
    clientSecret,
  })
  authApp = createAuthServer(identity, { origin: authOrigin, serviceKey })
  const provider = remoteIdentity({
    issuer: authOrigin + '/api/auth',
    origin,
    clientId: 'dovo-connect',
    clientSecret,
    serviceKey,
  })
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url === 'https://github.com/login/oauth/access_token') {
      const body = new URLSearchParams(init.body)
      assert.equal(body.get('code'), 'browser-code')
      assert.equal(body.get('redirect_uri'), authOrigin + '/api/auth/callback/github')
      assert.ok(body.get('code_verifier'))
      return Response.json({
        access_token: 'browser-test-token',
        token_type: 'bearer',
        scope: 'read:user,user:email',
      })
    }
    if (url === 'https://api.github.com/user')
      return Response.json({
        id: 123,
        login: 'browser-user',
        name: 'Browser user',
        email: 'browser@example.test',
        avatar_url: '',
      })
    if (url === 'https://api.github.com/user/emails')
      return Response.json([{ email: 'browser@example.test', verified: true, primary: true }])
    if (!url.startsWith(origin + '/') && !url.startsWith(authOrigin + '/'))
      throw Error('Unexpected external request')
    return realFetch(input, init)
  }
  app = createConnectServer({ ...provider, store, origin })
  browser = await chromium.launch()
  const page = await browser.newPage()
  const violations = []
  await page.addInitScript(() => {
    window.addEventListener('securitypolicyviolation', (event) =>
      console.error(`CSP violation: ${event.violatedDirective}`),
    )
  })
  page.on('console', (message) => {
    if (message.text().includes('CSP violation:')) violations.push(message.text())
  })
  const { login, token } = store.createLogin()
  await page.goto(`${origin}/auth/start?id=${login.id}`)
  await page.getByRole('button', { name: 'Continue to Dovo sign-in', exact: true }).click()
  await page.getByRole('button', { name: 'Continue with GitHub', exact: true }).click()
  try {
    await page
      .getByRole('heading', { name: 'You are signed in', exact: true })
      .waitFor({ timeout: 5000 })
  } catch (error) {
    console.error({ url: page.url(), body: await page.locator('body').innerText(), violations })
    throw error
  }
  assert.equal(store.directory(token)?.user.id, 'browser-user')
  assert.deepEqual(violations, [])
  assert.equal(new URL(page.url()).origin, origin)
  assert.equal((await page.request.get(origin + '/v1/servers')).status(), 401)
  console.log(
    'Connect Better Auth browser sign-in: GitHub redirect, PKCE, browser cookies, owner mapping, scoped bearer boundary and CSP pass.',
  )
} finally {
  globalThis.fetch = realFetch
  await browser?.close()
  await new Promise((resolve) => {
    ingress.close(resolve)
    ingress.closeAllConnections()
  })
  await new Promise((resolve) => {
    authIngress.close(resolve)
    authIngress.closeAllConnections()
  })
  app?.closeAllConnections()
  identity?.close()
  store.db.close()
}
