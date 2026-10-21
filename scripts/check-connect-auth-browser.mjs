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
let githubUserId = 123
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
        id: githubUserId,
        login: 'browser-user',
        name: 'Browser user',
        email: `browser-${githubUserId}@example.test`,
        avatar_url: '',
      })
    if (url === 'https://api.github.com/user/emails')
      return Response.json([
        { email: `browser-${githubUserId}@example.test`, verified: true, primary: true },
      ])
    if (!url.startsWith(origin + '/') && !url.startsWith(authOrigin + '/'))
      throw Error('Unexpected external request')
    return realFetch(input, init)
  }
  app = createConnectServer({ ...provider, store, origin })
  browser = await chromium.launch()
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
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
  await page.goto(authOrigin + '/account')
  await page.getByRole('heading', { name: 'Active Auth sessions', exact: true }).waitFor()
  await page.getByLabel('Display name').fill('Dovo <owner>')
  await page.getByRole('button', { name: 'Save profile', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Your profile has been updated.' }).waitFor()
  assert.equal(await page.getByLabel('Display name').inputValue(), 'Dovo <owner>')
  const owner = identity.db.prepare("SELECT userId FROM account WHERE accountId='123'").get()
  assert.equal(identity.ownerId(owner.userId), 'browser-user')
  assert.equal(await page.locator('owner').count(), 0)
  const blocked = await page.request.post(authOrigin + '/account/profile', {
    headers: { Origin: 'https://attacker.example.test' },
    form: { name: 'Attacker' },
  })
  assert.equal(blocked.status(), 403)
  const invalidName = await page.request.post(authOrigin + '/account/profile', {
    headers: { Origin: authOrigin },
    form: { name: ' ' },
  })
  assert.equal(invalidName.status(), 400)
  const unknownSession = await page.request.post(authOrigin + '/account/revoke-session', {
    headers: { Origin: authOrigin },
    form: { id: 'another-users-session' },
  })
  assert.equal(unknownSession.status(), 404)
  const other = await browser.newContext()
  const second = await other.newPage()
  second.setDefaultTimeout(10000)
  await second.goto(authOrigin + '/')
  await second.getByRole('button', { name: 'Continue with GitHub', exact: true }).click()
  await second.getByRole('heading', { name: 'Active Auth sessions', exact: true }).waitFor()
  await page.reload()
  assert.equal(await page.getByRole('button', { name: 'Sign out session', exact: true }).count(), 1)
  await page.getByRole('button', { name: 'Sign out session', exact: true }).click()
  await second.goto(authOrigin + '/account')
  await second.getByRole('button', { name: 'Continue with GitHub', exact: true }).waitFor()
  await second.getByRole('button', { name: 'Continue with GitHub', exact: true }).click()
  await second.getByRole('heading', { name: 'Active Auth sessions', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Sign out other browsers', exact: true }).click()
  await second.goto(authOrigin + '/account')
  await second.getByRole('button', { name: 'Continue with GitHub', exact: true }).waitFor()
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  }
  assert.deepEqual(violations, [])
  const ownSessions = identity.db.prepare('SELECT id, token FROM session').all()
  const html = await page.content()
  for (const session of ownSessions) assert.ok(!html.includes(session.token))
  githubUserId = 456
  const strangerContext = await browser.newContext()
  const stranger = await strangerContext.newPage()
  stranger.setDefaultTimeout(10000)
  await stranger.goto(authOrigin + '/sign-in')
  await stranger.getByRole('button', { name: 'Continue with GitHub', exact: true }).click()
  await stranger.getByRole('heading', { name: 'Active Auth sessions', exact: true }).waitFor()
  const crossAccount = await stranger.request.post(authOrigin + '/account/revoke-session', {
    headers: { Origin: authOrigin },
    form: { id: ownSessions[0].id },
  })
  assert.equal(crossAccount.status(), 404)
  await page.goto(authOrigin + '/account')
  await page.getByRole('heading', { name: 'Active Auth sessions', exact: true }).waitFor()
  await page.screenshot({ path: '/tmp/dovo-auth-account-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: '/tmp/dovo-auth-account-mobile.png', fullPage: true })
  await strangerContext.close()
  await page.getByRole('button', { name: 'Sign out of this browser', exact: true }).click()
  await page.getByRole('button', { name: 'Continue with GitHub', exact: true }).waitFor()
  await page.screenshot({ path: '/tmp/dovo-auth-sign-in-mobile.png', fullPage: true })
  await page.goto(authOrigin + '/sign-in?client_id=tampered')
  await page.getByRole('heading', { name: 'This sign-in has expired.', exact: true }).waitFor()
  await page.goto(authOrigin + '/error?error=access_denied')
  await page.getByRole('heading', { name: 'Let’s try that again.', exact: true }).waitFor()
  await other.close()
  console.log(
    'Dovo Auth account UI: profile, escaping, CSRF, session ownership, individual and bulk revocation, sign-out, standalone GitHub login, expired requests, responsive layouts and CSP pass.',
  )
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
